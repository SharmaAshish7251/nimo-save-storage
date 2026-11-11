/**
 * chunker.ts — Multi-Part Chunking Engine
 *
 * Splits large files (>1.95 GB) into sequential parts using streaming I/O,
 * keeping memory usage under ~25 MB at all times.
 *
 * Part naming convention:  filename.ext.part1, filename.ext.part2, …
 * Compatible with 7-Zip, ZArchiver, and POSIX `cat` for restoration.
 */

import * as FileSystem from 'expo-file-system/legacy';

/** 1.95 GB — leaves ~50 MB headroom below Telegram's 2 GB free-tier limit */
export const CHUNK_SIZE_BYTES = 1.95 * 1024 * 1024 * 1024;

/** Buffer size for each streaming read/write cycle — ~16 MB, well under 25 MB RAM budget */
const BUFFER_SIZE = 16 * 1024 * 1024; // 16 MB in bytes

/** Base64 overhead factor: every 3 raw bytes → 4 base64 chars, so buffer in base64 is 4/3 × larger */
const BASE64_BUFFER_SIZE = Math.ceil(BUFFER_SIZE * (4 / 3));

/** Directory where chunk temp files are stored */
const CHUNK_DIR = `${FileSystem.cacheDirectory}tdlib_upload/chunks/`;

export interface ChunkResult {
  /** Absolute file:// URIs for each chunk, in order */
  chunkPaths: string[];
  totalParts: number;
  originalSize: number;
  originalFileName: string;
}

/**
 * Returns true if the file needs to be split into chunks
 * before uploading to a free Telegram account.
 */
export function needsChunking(sizeBytes: number): boolean {
  return sizeBytes > CHUNK_SIZE_BYTES;
}

/**
 * Splits `uri` into sequential chunk files stored in the app cache directory.
 * Streams 16 MB at a time — peak RAM usage stays under ~25 MB.
 *
 * @param uri       Local file:// or content:// URI of the source file
 * @param fileName  Human-readable file name (e.g. "movie.mp4")
 * @returns         ChunkResult with paths, count, and original size
 */
export async function splitFileIntoChunks(
  uri: string,
  fileName: string,
): Promise<ChunkResult> {
  // Ensure chunk directory exists
  const dirInfo = await FileSystem.getInfoAsync(CHUNK_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CHUNK_DIR, { intermediates: true });
  }

  // Stat the source file to know the total size — cast needed as legacy FS types differ
  const fileInfo = await (FileSystem as any).getInfoAsync(uri, { size: true });
  if (!fileInfo.exists) {
    throw new Error(`[Chunker] Source file not found: ${uri}`);
  }
  const totalBytes: number = (fileInfo as any).size ?? 0;
  if (totalBytes <= 0) {
    throw new Error(`[Chunker] Cannot read file size for: ${uri}`);
  }

  const totalParts = Math.ceil(totalBytes / CHUNK_SIZE_BYTES);
  const chunkPaths: string[] = [];

  // Sanitise fileName for use in file paths (replace slashes, colons, etc.)
  const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_');

  let byteOffset = 0;
  let partIndex = 1;

  while (byteOffset < totalBytes) {
    const partPath = `${CHUNK_DIR}${safeName}.part${partIndex}`;
    const bytesThisChunk = Math.min(CHUNK_SIZE_BYTES, totalBytes - byteOffset);

    // Write chunk using streaming base64 reads to keep RAM low
    await writeChunkStreaming(uri, partPath, byteOffset, bytesThisChunk);

    chunkPaths.push(partPath);
    byteOffset += bytesThisChunk;
    partIndex++;

    console.log(
      `[Chunker] Part ${partIndex - 1}/${totalParts} written (${formatBytes(bytesThisChunk)})`,
    );
  }

  return {
    chunkPaths,
    totalParts,
    originalSize: totalBytes,
    originalFileName: fileName,
  };
}

/**
 * Streams a slice of `sourceUri` into `destPath` using 16 MB read windows.
 * expo-file-system/legacy reads and writes in base64, so we convert between
 * base64 ↔ byte offsets carefully.
 */
async function writeChunkStreaming(
  sourceUri: string,
  destPath: string,
  startByte: number,
  lengthBytes: number,
): Promise<void> {
  // Delete dest file if it exists from a previous aborted attempt
  const destInfo = await FileSystem.getInfoAsync(destPath);
  if (destInfo.exists) {
    await FileSystem.deleteAsync(destPath, { idempotent: true });
  }

  let bytesWritten = 0;
  let isFirstBuffer = true;

  while (bytesWritten < lengthBytes) {
    const toRead = Math.min(BUFFER_SIZE, lengthBytes - bytesWritten);

    // readAsStringAsync position/length parameters work on BYTE offsets
    const base64Chunk = await (FileSystem as any).readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: startByte + bytesWritten,
      length: toRead,
    });

    if (!base64Chunk || base64Chunk.length === 0) {
      // EOF reached earlier than expected (file truncated?)
      break;
    }

    if (isFirstBuffer) {
      // Create the file with the first buffer
      await FileSystem.writeAsStringAsync(destPath, base64Chunk, {
        encoding: FileSystem.EncodingType.Base64,
      });
      isFirstBuffer = false;
    } else {
      // Append subsequent buffers
      await (FileSystem as any).writeAsStringAsync(destPath, base64Chunk, {
        encoding: FileSystem.EncodingType.Base64,
        append: true,
      });
    }

    // base64 decodes to 3/4 of its character count — compute actual bytes written
    const decodedBytes = Math.floor(base64Chunk.length * 0.75);
    bytesWritten += decodedBytes;

    // Allow JS event loop to breathe between large buffer writes
    await sleep(0);
  }
}

/**
 * Deletes all chunk temp files after a successful or failed upload.
 * Idempotent — safe to call even if files have already been deleted.
 */
export async function cleanupChunks(chunkPaths: string[]): Promise<void> {
  await Promise.all(
    chunkPaths.map((p) =>
      FileSystem.deleteAsync(p, { idempotent: true }).catch((err) =>
        console.warn(`[Chunker] Failed to delete chunk ${p}:`, err),
      ),
    ),
  );
}

/** Convenience human-readable size formatter for log messages */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Zero-delay yield so the React Native JS thread stays responsive */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// suppress unused import warning — BASE64_BUFFER_SIZE is a sizing constant for documentation
void BASE64_BUFFER_SIZE;

