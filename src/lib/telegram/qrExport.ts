import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';

export interface QrSvgRef {
  toDataURL: (callback: (base64: string) => void, options?: { width: number; height: number }) => void;
}

export interface SaveQrResult {
  saved: boolean;
  permissionDenied?: boolean;
}

const QR_EXPORT_SIZE_PX = 640;
const QR_CACHE_PREFIX = 'telegram_login_qr_';

function ensureCacheDir(): string {
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error('Temporary cache directory is unavailable on this device.');
  }
  return dir;
}

async function captureQrPngBase64(svgRef: QrSvgRef): Promise<string> {
  if (!svgRef || typeof svgRef.toDataURL !== 'function') {
    throw new Error('QR code image is not ready yet. Please wait a moment and try again.');
  }

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out while rendering QR code image.'));
    }, 5000);

    try {
      svgRef.toDataURL(
        (rawData: string) => {
          clearTimeout(timer);
          if (!rawData) {
            reject(new Error('Failed to capture QR code image data.'));
            return;
          }
          const cleanBase64 = rawData
            .replace(/^data:image\/[^;]+;base64,/i, '')
            .replace(/\s+/g, '');
          if (!cleanBase64) {
            reject(new Error('Captured QR code image data was empty.'));
            return;
          }
          resolve(cleanBase64);
        },
        { width: QR_EXPORT_SIZE_PX, height: QR_EXPORT_SIZE_PX }
      );
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Removes any stale temporary QR export PNGs from the app cache directory.
 */
export async function cleanupCachedQrImages(): Promise<void> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return;
  try {
    const entries = await FileSystem.readDirectoryAsync(cacheDir);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(QR_CACHE_PREFIX) && name.endsWith('.png'))
        .map((name) => FileSystem.deleteAsync(`${cacheDir}${name}`, { idempotent: true }).catch(() => {}))
    );
  } catch {
    // Cache cleanup is best-effort
  }
}

async function exportQrToCachePng(svgRef: QrSvgRef): Promise<string> {
  const cacheDir = ensureCacheDir();
  const base64 = await captureQrPngBase64(svgRef);
  const fileUri = `${cacheDir}${QR_CACHE_PREFIX}${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}

/**
 * Saves the rendered QR SVG as a high-contrast PNG into the device gallery.
 */
export async function saveQrCodeToGallery(svgRef: QrSvgRef): Promise<SaveQrResult> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (perm.status !== MediaLibrary.PermissionStatus.GRANTED) {
    return { saved: false, permissionDenied: true };
  }

  const pngUri = await exportQrToCachePng(svgRef);
  try {
    await MediaLibrary.saveToLibraryAsync(pngUri);
    return { saved: true };
  } finally {
    await FileSystem.deleteAsync(pngUri, { idempotent: true }).catch(() => {});
  }
}

/**
 * Exports the rendered QR SVG as a PNG and opens the native share sheet.
 */
export async function shareQrCodeImage(svgRef: QrSvgRef): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('System sharing is not available on this device.');
  }

  // Clean older QR share files first without deleting the newly shared file prematurely.
  await cleanupCachedQrImages();
  const pngUri = await exportQrToCachePng(svgRef);

  await Sharing.shareAsync(pngUri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share Telegram Login QR Code',
  });
}

