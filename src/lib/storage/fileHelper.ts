import { File, Paths, Directory } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';

export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'other';

export interface ResolvedLocalTarget {
  exists: boolean;
  size: number;
  resolvedUri: string;
  mediaAssetId?: string;
  canAutoDelete: boolean;
  isContentOnly: boolean;
}

export function getFileCategory(
  fileName: string,
  mimeType?: string
): FileCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mime = (mimeType || '').toLowerCase();

  if (
    mime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg'].includes(ext)
  ) {
    return 'image';
  }
  if (
    mime.startsWith('video/') ||
    ['mp4', 'mkv', 'mov', '3gp', 'avi', 'webm', 'ts'].includes(ext)
  ) {
    return 'video';
  }
  if (
    mime.startsWith('audio/') ||
    ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'opus'].includes(ext)
  ) {
    return 'audio';
  }
  if (
    mime.startsWith('application/pdf') ||
    mime.startsWith('text/') ||
    [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'txt',
      'csv',
      'zip',
      'rar',
      '7z',
      'tar',
      'gz',
    ].includes(ext)
  ) {
    return 'document';
  }

  return 'other';
}

function safeDecodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extracts a numeric Android MediaStore _ID from MediaDocuments or MediaStore content:// URIs.
 * Returns null for non-numeric or unsupported URI schemes so MediaLibrary.deleteAssetsAsync
 * is never called with an invalid ID.
 */
export function extractMediaStoreAssetId(uri: string): string | null {
  if (!uri || !uri.startsWith('content://')) return null;

  if (uri.includes('com.android.providers.media.documents/document/')) {
    const rawDocId = uri.split('/document/')[1]?.split('?')[0] || '';
    const decoded = safeDecodeComponent(rawDocId);
    const match = decoded.match(/^(?:image|video|audio):(\d+)$/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  if (uri.includes('content://media/')) {
    const clean = uri.split('?')[0];
    const match = clean.match(/\/(\d+)$/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Maps ExternalStorage / Raw Downloads DocumentPicker content:// URIs back to
 * a file:///storage/emulated/0/... URI when Android encodes the relative path.
 */
export function extractDirectFileUriFromContentUri(uri: string): string | null {
  if (!uri || !uri.startsWith('content://')) return null;

  const docPart = uri.split('/document/')[1]?.split('?')[0];
  if (!docPart) return null;

  const decoded = safeDecodeComponent(docPart);

  if (uri.includes('com.android.externalstorage.documents/document/')) {
    if (decoded.startsWith('primary:')) {
      const rel = decoded.slice('primary:'.length).replace(/^\/+/, '');
      if (rel) {
        return `file:///storage/emulated/0/${rel}`;
      }
    }
  }

  if (uri.includes('com.android.providers.downloads.documents/document/')) {
    if (decoded.startsWith('raw:')) {
      const absPath = decoded.slice('raw:'.length);
      if (absPath.startsWith('/')) {
        return `file://${absPath}`;
      }
    }
  }

  return null;
}

async function hasMediaLibraryPermission(requestIfNeeded = false): Promise<boolean> {
  try {
    const current = await MediaLibrary.getPermissionsAsync();
    if (
      current.granted ||
      current.status === MediaLibrary.PermissionStatus.GRANTED ||
      (current.status as string) === 'limited'
    ) {
      return true;
    }
    if (!requestIfNeeded) return false;
    const requested = await MediaLibrary.requestPermissionsAsync();
    return (
      requested.granted ||
      requested.status === MediaLibrary.PermissionStatus.GRANTED ||
      (requested.status as string) === 'limited'
    );
  } catch {
    return false;
  }
}

async function statLocalFileUri(
  uri: string
): Promise<{ exists: boolean; size: number }> {
  if (!uri || uri.startsWith('content://')) return { exists: false, size: 0 };

  try {
    const info = await LegacyFileSystem.getInfoAsync(uri);
    if (info.exists && !info.isDirectory) {
      return { exists: true, size: Number((info as any).size) || 0 };
    }
  } catch {
    // ignore and try encoded variant if spaces exist
  }

  const encodedUri = uri.includes(' ') ? encodeURI(uri) : uri;
  if (encodedUri !== uri) {
    try {
      const info = await LegacyFileSystem.getInfoAsync(encodedUri);
      if (info.exists && !info.isDirectory) {
        return { exists: true, size: Number((info as any).size) || 0 };
      }
    } catch {
      // ignore
    }
  }

  return { exists: false, size: 0 };
}

export async function findMatchingMediaLibraryAsset(params: {
  fileName: string;
  size?: number;
  category?: FileCategory;
  contentUri?: string;
  mediaAssetId?: string;
  requestPermission?: boolean;
}): Promise<{ id: string; uri: string; size: number } | null> {
  const permitted = await hasMediaLibraryPermission(Boolean(params.requestPermission));
  if (!permitted) return null;

  const candidateId =
    params.mediaAssetId ||
    (params.contentUri ? extractMediaStoreAssetId(params.contentUri) : null);

  if (candidateId) {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(candidateId);
      const localUri = info?.localUri || info?.uri;
      if (info && localUri) {
        if (localUri.startsWith('ph://')) {
          return { id: info.id || candidateId, uri: localUri, size: params.size || 0 };
        }
        const stat = await statLocalFileUri(localUri);
        if (stat.exists) {
          return {
            id: info.id || candidateId,
            uri: localUri,
            size: stat.size > 0 ? stat.size : params.size || 0,
          };
        }
      }
    } catch {
      // Fall through to filename+size lookup
    }
  }

  const category = params.category || getFileCategory(params.fileName);
  const mediaType: MediaLibrary.MediaTypeValue | null =
    category === 'image'
      ? 'photo'
      : category === 'video'
        ? 'video'
        : category === 'audio'
          ? 'audio'
          : null;

  if (!mediaType || !params.fileName) return null;

  const expectedSize = params.size || 0;
  let after: string | undefined;
  const maxPages = 5;
  const nameMatches: { id: string; uri: string; size: number }[] = [];

  try {
    for (let page = 0; page < maxPages; page++) {
      const res = await MediaLibrary.getAssetsAsync({
        mediaType,
        first: 200,
        after,
        sortBy: ['modificationTime'],
      });

      for (const asset of res.assets) {
        if (asset.filename !== params.fileName) continue;
        const stat = await statLocalFileUri(asset.uri);
        if (!stat.exists) continue;

        if (expectedSize > 0 && stat.size === expectedSize) {
          return { id: asset.id, uri: asset.uri, size: stat.size };
        }
        nameMatches.push({ id: asset.id, uri: asset.uri, size: stat.size });
      }

      if (!res.hasNextPage || !res.endCursor) break;
      after = res.endCursor;
    }
  } catch {
    return null;
  }

  // Only match by filename alone if there is a single unambiguous asset and no known expected size mismatch
  if (expectedSize <= 0 && nameMatches.length === 1) {
    return nameMatches[0];
  }

  return null;
}

/**
 * Resolves any stored or picked URI (file://, ph://, SAF content://, DocumentPicker content://)
 * to its actual local availability, size, canonical persistent URI, MediaLibrary asset ID,
 * and whether Android allows programmatic deletion.
 */
export async function resolveLocalFileTarget(params: {
  uri: string;
  fileName: string;
  size?: number;
  mimeType?: string;
  mediaAssetId?: string;
  allowMediaMatch?: boolean;
  requestPermission?: boolean;
}): Promise<ResolvedLocalTarget> {
  const { uri, fileName, size = 0, mimeType } = params;
  if (!uri) {
    return {
      exists: false,
      size: 0,
      resolvedUri: '',
      canAutoDelete: false,
      isContentOnly: false,
    };
  }

  const category = getFileCategory(fileName, mimeType);

  // 1. If we already have a MediaLibrary asset ID, verify via MediaLibrary first
  if (params.mediaAssetId) {
    const matchedById = await findMatchingMediaLibraryAsset({
      fileName,
      size,
      category,
      mediaAssetId: params.mediaAssetId,
      requestPermission: false,
    });
    if (matchedById) {
      return {
        exists: true,
        size: matchedById.size > 0 ? matchedById.size : size,
        resolvedUri: matchedById.uri,
        mediaAssetId: matchedById.id,
        canAutoDelete: true,
        isContentOnly: false,
      };
    }
  }

  // 2. Non-content URIs (file://, raw local path, iOS ph://)
  if (!uri.startsWith('content://')) {
    if (uri.startsWith('ph://')) {
      const permitted = await hasMediaLibraryPermission(false);
      if (permitted) {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(uri);
          const localUri = info?.localUri || info?.uri;
          if (info && localUri) {
            const stat = localUri.startsWith('ph://')
              ? { exists: true, size }
              : await statLocalFileUri(localUri);
            if (stat.exists) {
              return {
                exists: true,
                size: stat.size > 0 ? stat.size : size,
                resolvedUri: localUri,
                mediaAssetId: info.id || uri,
                canAutoDelete: true,
                isContentOnly: false,
              };
            }
          }
        } catch {
          // fall through
        }
      }
      return {
        exists: false,
        size: 0,
        resolvedUri: uri,
        canAutoDelete: false,
        isContentOnly: false,
      };
    }

    const normalizedUri = uri.startsWith('/') ? `file://${uri}` : uri;
    const stat = await statLocalFileUri(normalizedUri);
    if (stat.exists) {
      return {
        exists: true,
        size: stat.size > 0 ? stat.size : size,
        resolvedUri: normalizedUri,
        mediaAssetId: params.mediaAssetId,
        canAutoDelete: true,
        isContentOnly: false,
      };
    }

    return {
      exists: false,
      size: 0,
      resolvedUri: normalizedUri,
      canAutoDelete: false,
      isContentOnly: false,
    };
  }

  // 3. content:// URIs — attempt to resolve to a persistent, deletable target
  if (params.allowMediaMatch !== false) {
    const matchedMedia = await findMatchingMediaLibraryAsset({
      fileName,
      size,
      category,
      contentUri: uri,
      mediaAssetId: params.mediaAssetId,
      requestPermission: params.requestPermission,
    });
    if (matchedMedia) {
      return {
        exists: true,
        size: matchedMedia.size > 0 ? matchedMedia.size : size,
        resolvedUri: matchedMedia.uri,
        mediaAssetId: matchedMedia.id,
        canAutoDelete: true,
        isContentOnly: false,
      };
    }
  }

  // 4. ExternalStorage / raw Downloads document provider path mapping
  const directFileUri = extractDirectFileUriFromContentUri(uri);
  if (directFileUri) {
    const stat = await statLocalFileUri(directFileUri);
    if (stat.exists && (size <= 0 || stat.size <= 0 || stat.size === size)) {
      return {
        exists: true,
        size: stat.size > 0 ? stat.size : size,
        resolvedUri: directFileUri,
        mediaAssetId: params.mediaAssetId,
        canAutoDelete: true,
        isContentOnly: false,
      };
    }
  }

  // 5. Fallback: inspect the content:// URI directly without blindly assuming existence
  let contentExists = false;
  let contentSize = 0;

  try {
    const file = new File(uri);
    if (file.exists) {
      contentExists = true;
      contentSize = Number(file.size) || 0;
    }
  } catch {
    // ignore
  }

  if (!contentExists) {
    try {
      const info = await LegacyFileSystem.getInfoAsync(uri);
      if (info.exists && !info.isDirectory) {
        contentExists = true;
        contentSize = Number((info as any).size) || 0;
      }
    } catch {
      // Expired temporary DocumentPicker grant or inaccessible provider
    }
  }

  if (!contentExists) {
    return {
      exists: false,
      size: 0,
      resolvedUri: uri,
      canAutoDelete: false,
      isContentOnly: true,
    };
  }

  const isAutoDeletableContent =
    uri.includes('/tree/') || uri.includes('content://media/');

  return {
    exists: true,
    size: contentSize > 0 ? contentSize : size,
    resolvedUri: uri,
    mediaAssetId: extractMediaStoreAssetId(uri) || params.mediaAssetId,
    canAutoDelete: isAutoDeletableContent,
    isContentOnly: !isAutoDeletableContent,
  };
}

const CACHE_DIR = new Directory(Paths.cache, 'nimo_upload');

function ensureCacheDir() {
  try {
    if (!CACHE_DIR.exists) {
      CACHE_DIR.create({ intermediates: true });
    }
  } catch {}
}

export async function getFileInfo(
  uri: string
): Promise<{ exists: boolean; size: number }> {
  if (!uri) return { exists: false, size: 0 };

  try {
    const file = new File(uri);
    if (file.exists) {
      return {
        exists: true,
        size: Number(file.size) || 0,
      };
    }
  } catch {
    // continue to fallbacks
  }

  if (!uri.startsWith('content://')) {
    try {
      const info = await LegacyFileSystem.getInfoAsync(uri);
      if (info.exists && !info.isDirectory) {
        return {
          exists: true,
          size: info.size || 0,
        };
      }
    } catch {
      // continue
    }
  }

  if (uri.startsWith('content://')) {
    try {
      const info = await LegacyFileSystem.getInfoAsync(uri);
      if (info.exists && typeof (info as any).size === 'number') {
        return { exists: true, size: (info as any).size };
      }
    } catch {
      // continue
    }
    return { exists: true, size: 0 };
  }

  return { exists: false, size: 0 };
}

export async function readFileToBuffer(uri: string): Promise<Buffer> {
  if (!uri) {
    throw new Error('readFileToBuffer: URI is required');
  }

  if (uri.startsWith('content://')) {
    try {
      ensureCacheDir();
      const name = uri.split('/').pop() || `file_${Date.now()}`;
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const cacheFile = new File(CACHE_DIR, `${Date.now()}_${safeName}`);
      const res = await fetch(uri);
      const arrayBuffer = await res.arrayBuffer();
      cacheFile.create();
      cacheFile.write(arrayBuffer);
      try {
        const bytes = await cacheFile.bytes();
        if (bytes && bytes.length > 0) {
          return Buffer.from(bytes);
        }
      } catch {}
      const b64 = await cacheFile.base64();
      if (b64) {
        return Buffer.from(b64, 'base64');
      }
    } catch (err) {
      console.warn('[readFileToBuffer] content:// cache copy failed, trying direct:', err);
    }
  }

  try {
    const file = new File(uri);
    if (typeof (file as any).bytes === 'function') {
      const bytes = await file.bytes();
      if (bytes && bytes.length > 0) {
        return Buffer.from(bytes);
      }
    }
    if (typeof (file as any).base64 === 'function') {
      const b64 = await file.base64();
      if (b64) {
        return Buffer.from(b64, 'base64');
      }
    }
  } catch (err) {
    console.warn('[readFileToBuffer] Modern File API read failed, trying fallbacks:', err);
  }

  if (!uri.startsWith('content://')) {
    try {
      const base64 = await LegacyFileSystem.readAsStringAsync(uri, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      });
      return Buffer.from(base64, 'base64');
    } catch (err) {
      console.warn('[readFileToBuffer] Legacy readAsStringAsync failed:', err);
    }
  }

  try {
    const response = await fetch(uri);
    if (typeof (response as any).arrayBuffer === 'function') {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer && arrayBuffer.byteLength > 0) {
        return Buffer.from(arrayBuffer);
      }
    }
    const blob = await response.blob();
    if (typeof (blob as any).arrayBuffer === 'function') {
      const arrayBuffer = await blob.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    return await new Promise<Buffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(Buffer.from(b64, 'base64'));
      };
      reader.onerror = () => reject(new Error('FileReader failed to read blob'));
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[readFileToBuffer] fetch + blob fallback failed:', err);
  }

  throw new Error(`Unable to read file content for URI: ${uri}`);
}

/**
 * Copies a SAF content:// URI to the local app cache directory and returns
 * the local absolute path (without file:// prefix) so TDLib can access it.
 * For regular file:// or /path URIs, strips the scheme and returns as-is.
 */
export async function copyToLocalPath(uri: string, fileName: string): Promise<string> {
  if (!uri.startsWith('content://')) {
    // Already a local file — return the path without file:// scheme
    return uri.startsWith('file://') ? uri.slice(7) : uri;
  }

  // SAF content:// URI — copy to app cache dir via expo-file-system
  ensureCacheDir();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destUri = `${LegacyFileSystem.cacheDirectory}nimo_upload/${Date.now()}_${safeName}`;

  await LegacyFileSystem.copyAsync({ from: uri, to: destUri });

  // Return raw path without file:// scheme
  return destUri.startsWith('file://') ? destUri.slice(7) : destUri;
}

/**
 * Computes a fast signature hash for a file using up to the first 256 KB.
 * Avoids loading multi-gigabyte files into RAM.
 */
export async function computeFastFileHash(uri: string, size: number): Promise<string> {
  try {
    const sampleLength = Math.min(Math.max(size, 0), 256 * 1024);
    const chunk = await LegacyFileSystem.readAsStringAsync(uri, {
      encoding: 'base64',
      length: sampleLength,
      position: 0,
    });
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${size}_${chunk}`);
  } catch {
    try {
      if (size > 0 && size < 5 * 1024 * 1024) {
        const full = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${size}_${full}`);
      }
      return `${size}_${uri.split('/').pop() || 'unknown'}`;
    } catch {
      return `${size}_unknown`;
    }
  }
}
