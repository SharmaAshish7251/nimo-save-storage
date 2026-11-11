import { File, Paths, Directory } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

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
