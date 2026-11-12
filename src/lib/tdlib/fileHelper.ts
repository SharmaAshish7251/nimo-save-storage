import * as LegacyFileSystem from 'expo-file-system/legacy';

const UPLOAD_CACHE_DIR = `${LegacyFileSystem.cacheDirectory}tdlib_upload/`;

// Fix 3.1: Safe wrapper — prevents URIError crash on filenames with literal % characters
function safeDecodeURI(uri: string): string {
  try {
    return decodeURI(uri);
  } catch {
    return uri;
  }
}

/**
 * Resolves any URI (content://, file://, or raw path) into an absolute
 * native filesystem path that TDLib's native C++ engine can read directly.
 *
 * Scoped Storage Note:
 * On Android 11+ (API 30+), TDLib's native C++ MTProto engine cannot directly
 * open raw /storage/emulated/0/... paths or content:// URIs due to Scoped Storage.
 * Therefore, any file that is not already inside the app's private sandbox
 * (/data/user/0/ or /data/data/) is streamed natively into the app cache.
 */
export async function resolveToLocalPath(
  uri: string,
  preferredFileName?: string
): Promise<{ path: string; isTemp: boolean }> {
  if (!uri) {
    throw new Error('resolveToLocalPath: URI is required');
  }

  // Clean / sanitize preferred filename if provided
  const safeName = preferredFileName
    ? preferredFileName.replace(/[/\\?%*:|"<>]/g, '_')
    : null;

  // Direct disk access if already an accessible file on disk AND already has the correct filename
  if (uri.startsWith('/') || uri.startsWith('file://')) {
    const rawPath = safeDecodeURI(uri.replace(/^file:\/\//, ''));
    const currentBaseName = rawPath.split('/').pop() || '';
    if (!safeName || currentBaseName === safeName) {
      try {
        const fileInfo = await LegacyFileSystem.getInfoAsync(uri);
        if (fileInfo.exists) {
          console.log(`[resolveToLocalPath] Direct local path used (zero-copy): ${rawPath}`);
          return { path: rawPath, isTemp: false };
        }
      } catch (e) {
        console.warn('[resolveToLocalPath] Direct path check failed, falling back to cache:', e);
      }
    }
  }

  // Ensure cache directory exists
  try {
    const dirInfo = await LegacyFileSystem.getInfoAsync(UPLOAD_CACHE_DIR);
    if (!dirInfo.exists) {
      await LegacyFileSystem.makeDirectoryAsync(UPLOAD_CACHE_DIR, { intermediates: true });
    }
  } catch (err) {
    console.warn('[resolveToLocalPath] Failed to ensure cache directory:', err);
  }

  // Preserve the real file name and extension
  let fileName: string;
  if (safeName) {
    fileName = safeName;
  } else {
    const cleanUri = uri.split('?')[0];
    const extMatch = cleanUri.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? `.${extMatch[1]}` : '.bin';
    fileName = `tdlib_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  }

  let targetUri = `${UPLOAD_CACHE_DIR}${fileName}`;
  // Avoid collision if a temp file with the same name already exists in cache
  try {
    const existing = await LegacyFileSystem.getInfoAsync(targetUri);
    if (existing.exists) {
      const dotIdx = fileName.lastIndexOf('.');
      const base = dotIdx !== -1 ? fileName.slice(0, dotIdx) : fileName;
      const ext = dotIdx !== -1 ? fileName.slice(dotIdx) : '';
      targetUri = `${UPLOAD_CACHE_DIR}${base}_${Date.now()}${ext}`;
    }
  } catch {}

  try {
    console.log(`[resolveToLocalPath] Copying ${uri.slice(0, 50)}... to app cache: ${targetUri}`);
    await LegacyFileSystem.copyAsync({
      from: uri,
      to: targetUri,
    });

    const targetPath = safeDecodeURI(targetUri.replace(/^file:\/\//, ''));
    console.log(`[resolveToLocalPath] Resolved to local native path: ${targetPath}`);
    return { path: targetPath, isTemp: true };
  } catch (err) {
    console.warn('[resolveToLocalPath] copyAsync failed, attempting fetch/blob fallback for content URI:', err);
    try {
      // Robust Android Scoped Storage fallback: fetch content:// stream as blob and write base64
      const res = await fetch(uri);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
      await LegacyFileSystem.writeAsStringAsync(targetUri, base64, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      });
      const targetPath = safeDecodeURI(targetUri.replace(/^file:\/\//, ''));
      return { path: targetPath, isTemp: true };
    } catch (fallbackErr) {
      console.error('[resolveToLocalPath] All resolution methods failed:', fallbackErr);
      throw new Error(`Failed to resolve local path for TDLib upload: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Ensures any URI (`content://`, `file://`, or raw path) is accessible as a
 * standard `file://` URI with the expected filename/extension, which Android
 * `expo-sharing` and `expo-media-library` strictly require.
 */
export async function ensureFileSchemeUri(
  uri: string,
  preferredFileName?: string
): Promise<string> {
  if (!uri) {
    throw new Error('ensureFileSchemeUri: URI is required');
  }

  // Fast-path if already a file:// URI (or raw filesystem path) that exists on disk
  if (uri.startsWith('file://') || uri.startsWith('/')) {
    const normalizedFileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    try {
      const info = await LegacyFileSystem.getInfoAsync(normalizedFileUri);
      if (info.exists) {
        return normalizedFileUri;
      }
    } catch {
      // Fall through to cache copy
    }
  }

  // For content:// (SAF / MediaStore) or unnormalized paths, stream into app cache
  const { path } = await resolveToLocalPath(uri, preferredFileName);
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * Infers a standard MIME type from a filename for Android sharing / viewing.
 */
export function getMimeTypeFromFileName(fileName?: string): string {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    '3gp': 'video/3gpp',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    log: 'text/plain',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    apk: 'application/vnd.android.package-archive',
  };
  return mimeMap[ext] || '*/*';
}

/**
 * Cleans up temporary cache files generated during upload.
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    const targetUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    await LegacyFileSystem.deleteAsync(targetUri, { idempotent: true });
  } catch (err) {
    console.warn('[cleanupTempFile] Error removing temp file:', err);
  }
}
