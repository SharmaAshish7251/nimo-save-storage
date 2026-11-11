/**
 * reassembler.ts — On-Demand Chunk Reassembly
 *
 * Downloads and concatenates multi-part files from Telegram on demand.
 * Streams 16 MB at a time — no full file ever loaded into memory.
 *
 * User flow:
 *   Cloud Explorer → tap a "Split" file → tap "Download & Restore" →
 *   reassembleChunks() streams all parts into one file in app cache dir.
 */

import * as FileSystem from 'expo-file-system/legacy';

/** Directory where reassembled files land (cleared periodically by OS) */
const REASSEMBLE_DIR = `${FileSystem.cacheDirectory}tdlib_upload/reassembled/`;

/** Buffer size for each streaming read/write cycle — stays under 25 MB RAM budget */
const BUFFER_SIZE = 16 * 1024 * 1024; // 16 MB

export interface ChunkManifest {
  /** Original file name before splitting, e.g. "movie.mp4" */
  originalFileName: string;
  /** Total size in bytes of the reassembled file */
  originalSize: number;
  /** Number of parts */
  totalParts: number;
  /** Per-part metadata (Telegram message IDs needed to fetch each part) */
  parts: {
    part: number;
    telegramMessageId: number;
    size: number;
  }[];
  /** Unix timestamp (ms) when the chunked upload completed */
  uploadedAt: number;
}

/**
 * Concatenates already-downloaded part files at `partUris` into `outputUri`.
 * `partUris` must be in order (part1 first).
 *
 * @param partUris   Local file:// URIs for each downloaded part, in order
 * @param outputUri  Destination path for the reassembled file
 * @param onProgress Optional progress callback (0–100)
 */
export async function reassembleChunks(
  partUris: string[],
  outputUri: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  // Ensure output directory exists
  const outDir = outputUri.substring(0, outputUri.lastIndexOf('/') + 1);
  const dirInfo = await FileSystem.getInfoAsync(outDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(outDir, { intermediates: true });
  }

  // Remove any stale output file
  const existing = await FileSystem.getInfoAsync(outputUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(outputUri, { idempotent: true });
  }

  // Calculate total bytes for progress reporting
  let totalBytes = 0;
  for (const partUri of partUris) {
    const info = await FileSystem.getInfoAsync(partUri);
    totalBytes += (info as any).size ?? 0;
  }

  let bytesProcessed = 0;
  let isFirstPart = true;

  for (const partUri of partUris) {
    const partInfo = await FileSystem.getInfoAsync(partUri);
    const partSize: number = (partInfo as any).size ?? 0;
    let partBytesRead = 0;

    while (partBytesRead < partSize) {
      const toRead = Math.min(BUFFER_SIZE, partSize - partBytesRead);

      const base64Buf = await (FileSystem as any).readAsStringAsync(partUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: partBytesRead,
        length: toRead,
      });

      if (!base64Buf || base64Buf.length === 0) break;

      if (isFirstPart && partBytesRead === 0) {
        // Create the output file with the very first buffer
        await FileSystem.writeAsStringAsync(outputUri, base64Buf, {
          encoding: FileSystem.EncodingType.Base64,
        });
        isFirstPart = false;
      } else {
        // Append subsequent buffers
        await (FileSystem as any).writeAsStringAsync(outputUri, base64Buf, {
          encoding: FileSystem.EncodingType.Base64,
          append: true,
        });
      }

      const decodedBytes = Math.floor((base64Buf.replace(/=/g, '').length * 3) / 4);
      partBytesRead += decodedBytes;
      bytesProcessed += decodedBytes;

      if (onProgress && totalBytes > 0) {
        onProgress(Math.min(100, Math.round((bytesProcessed / totalBytes) * 100)));
      }

      // Yield so the JS thread stays responsive
      await sleep(0);
    }

    console.log(`[Reassembler] Merged part: ${partUri}`);
  }

  onProgress?.(100);
  console.log(`[Reassembler] Reassembly complete → ${outputUri}`);
}

/**
 * Returns a cache-directory path for a reassembled file.
 * Creates the directory if needed.
 */
export async function getReassembleOutputPath(fileName: string): Promise<string> {
  const dirInfo = await FileSystem.getInfoAsync(REASSEMBLE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(REASSEMBLE_DIR, { intermediates: true });
  }
  const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_');
  return `${REASSEMBLE_DIR}${safeName}`;
}

/** Zero-delay yield so the React Native JS thread stays responsive */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

