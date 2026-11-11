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
    console.error('[resolveToLocalPath] Failed to copy file to cache:', err);
    throw new Error(`Failed to resolve local path for TDLib upload: ${err instanceof Error ? err.message : String(err)}`);
  }
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
