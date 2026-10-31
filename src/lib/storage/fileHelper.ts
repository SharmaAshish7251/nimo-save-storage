import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

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
      const res = await fetch(uri);
      const blob = await res.blob();
      if (blob && blob.size > 0) {
        return { exists: true, size: blob.size };
      }
      return { exists: true, size: 0 };
    } catch {
      return { exists: true, size: 0 };
    }
  }

  return { exists: false, size: 0 };
}

export async function readFileToBuffer(uri: string): Promise<Buffer> {
  if (!uri) {
    throw new Error('readFileToBuffer: URI is required');
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
    const blob = await response.blob();
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
