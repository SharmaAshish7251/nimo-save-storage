import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import PQueue from 'p-queue';
import {
  getUploadedIndex,
  getQueue,
  recordActionHistory,
} from './queue';
import {
  FileCategory,
  getFileCategory,
  resolveLocalFileTarget,
  findMatchingMediaLibraryAsset,
  extractMediaStoreAssetId,
} from './fileHelper';
import { verifyCloudRecord } from './cloudSync';

export interface CleanableItem {
  uri: string;
  /** Persistent file:// or ph:// URI when record.uri was a temporary content:// URI */
  resolvedUri?: string;
  /** MediaLibrary asset ID for reliable Android MediaStore deletion */
  mediaAssetId?: string;
  /** Whether Android/iOS permits programmatic deletion of this local copy */
  canAutoDelete: boolean;
  fileName: string;
  size: number;
  uploadedAt: number;
  category: FileCategory;
  telegramMessageId?: number;
  chatId?: number;
}

export interface CategorySummary {
  count: number;
  bytes: number;
}

export interface CleanerAnalysis {
  candidates: CleanableItem[];
  totalBytes: number;
  totalCount: number;
  categories: Record<FileCategory, CategorySummary>;
  /** Uploaded local content:// files whose deletion is restricted by Android Scoped Storage */
  restrictedCandidates: CleanableItem[];
  restrictedBytes: number;
  restrictedCount: number;
  /** Number of items still in queue that must finish uploading before appearing here */
  pendingQueueCount: number;
}

export interface CleanResult {
  freedCount: number;
  freedBytes: number;
  failedCount: number;
  /** Files skipped by the Safety Shield because their cloud copy was deleted in Telegram */
  blockedCount: number;
}

/**
 * Scans all confirmed cloud-uploaded files and checks which ones still
 * consume physical space on the local device.
 */
export async function analyzeCleanableSpace(): Promise<CleanerAnalysis> {
  const [uploaded, queue] = await Promise.all([
    getUploadedIndex(),
    getQueue().catch(() => []),
  ]);

  const pendingQueueCount = queue.filter((q) => q.status !== 'completed').length;

  const categories: Record<FileCategory, CategorySummary> = {
    image: { count: 0, bytes: 0 },
    video: { count: 0, bytes: 0 },
    audio: { count: 0, bytes: 0 },
    document: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
  };

  const candidates: CleanableItem[] = [];
  const restrictedCandidates: CleanableItem[] = [];
  let totalBytes = 0;
  let restrictedBytes = 0;

  // PERF-01: Parallelize with PQueue concurrency 10
  const pQueue = new PQueue({ concurrency: 10 });
  const tasks = uploaded.map((record) =>
    pQueue.add(async () => {
      // Safety Shield: Do NOT suggest cleaning local files whose cloud copies are marked missing
      if (record.cloudStatus === 'missing') return;

      try {
        const target = await resolveLocalFileTarget({
          uri: record.uri,
          fileName: record.fileName,
          size: record.size,
          mediaAssetId: record.mediaAssetId,
          allowMediaMatch: true,
          requestPermission: false,
        });

        if (!target.exists) return;

        const size = target.size > 0 ? target.size : record.size || 0;
        const category = getFileCategory(record.fileName);

        const item: CleanableItem = {
          uri: record.uri,
          ...(target.resolvedUri && target.resolvedUri !== record.uri
            ? { resolvedUri: target.resolvedUri }
            : {}),
          ...(target.mediaAssetId ? { mediaAssetId: target.mediaAssetId } : {}),
          canAutoDelete: target.canAutoDelete,
          fileName: record.fileName,
          size,
          uploadedAt: record.uploadedAt,
          category,
          telegramMessageId: record.telegramMessageId,
          chatId: record.chatId,
        };

        if (target.canAutoDelete) {
          candidates.push(item);
          totalBytes += size;
          categories[category].count += 1;
          categories[category].bytes += size;
        } else {
          restrictedCandidates.push(item);
          restrictedBytes += size;
        }
      } catch {
        // If unable to query local file, skip to be safe
      }
    })
  );

  await Promise.all(tasks);

  return {
    candidates,
    totalBytes,
    totalCount: candidates.length,
    categories,
    restrictedCandidates,
    restrictedBytes,
    restrictedCount: restrictedCandidates.length,
    pendingQueueCount,
  };
}

/**
 * Safely deletes confirmed local files from device storage to free up space.
 * Telegram cloud backup records remain untouched.
 *
 * SAFETY SHIELD: Probes Telegram Cloud before deleting each file. If the remote
 * message was deleted in Telegram, deletion is BLOCKED to prevent permanent data loss.
 */
export async function executeCleanSpace(
  items: CleanableItem[],
  onProgress?: (cleanedCount: number, total: number) => void
): Promise<CleanResult> {
  let freedCount = 0;
  let freedBytes = 0;
  let failedCount = 0;
  let blockedCount = 0;

  const uploaded = await getUploadedIndex();

  const checkUriGone = async (
    uriToVerify: string,
    fileName: string,
    size: number,
    mediaAssetId?: string
  ): Promise<boolean> => {
    const check = await resolveLocalFileTarget({
      uri: uriToVerify,
      fileName,
      size,
      mediaAssetId,
      allowMediaMatch: false,
      requestPermission: false,
    }).catch(() => ({ exists: true }));
    return !check.exists;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let deleted = false;

    // ── SAFETY SHIELD CHECK ──────────────────────────────────────────────────
    // Files are eligible for cleaning only if they have a confirmed cloud upload.
    // Safety Shield blocks deletion if cloudStatus is 'missing' or if the file was never uploaded.
    const rec = uploaded.find((u) => u.uri === item.uri);
    const hasCloudRecord = Boolean(rec && (rec.telegramMessageId || rec.chunkManifest || item.telegramMessageId));

    if (!hasCloudRecord || rec?.cloudStatus === 'missing') {
      console.warn(`[Cleaner Safety Shield] Blocked deletion of "${item.fileName}" — No valid Telegram cloud upload record found.`);
      blockedCount += 1;
      if (onProgress) onProgress(i + 1, items.length);
      continue;
    }

    // Active Safety Shield Live Verification: Verify message actually exists in Telegram Cloud before deleting local copy!
    if (rec) {
      try {
        const verification = await verifyCloudRecord(rec, item.chatId);
        if (!verification.exists) {
          console.warn(`[Cleaner Safety Shield] Blocked deletion of "${item.fileName}" — Cloud message no longer exists on Telegram.`);
          blockedCount += 1;
          if (onProgress) onProgress(i + 1, items.length);
          continue;
        }
      } catch (verifyErr) {
        console.warn(`[Cleaner Safety Shield] Verification failed for "${item.fileName}", blocking local deletion for safety:`, verifyErr);
        blockedCount += 1;
        if (onProgress) onProgress(i + 1, items.length);
        continue;
      }
    }

    if (!item.canAutoDelete) {
      failedCount += 1;
      if (onProgress) onProgress(i + 1, items.length);
      continue;
    }

    const targetUri = item.resolvedUri || item.uri;
    const assetId =
      item.mediaAssetId ||
      extractMediaStoreAssetId(targetUri) ||
      extractMediaStoreAssetId(item.uri) ||
      (targetUri.startsWith('ph://') ? targetUri : undefined);

    try {
      // Attempt 1: Delete via MediaLibrary using valid asset ID (required for Android Scoped Storage media)
      if (assetId) {
        try {
          const res = await MediaLibrary.deleteAssetsAsync([assetId]);
          if (res) {
            deleted = await checkUriGone(targetUri, item.fileName, item.size, assetId);
          }
        } catch {
          // Fall back to FileSystem.deleteAsync
        }
      }

      // Attempt 2: Direct FileSystem delete (works for SAF tree content:// and local file:// paths)
      if (!deleted) {
        try {
          await FileSystem.deleteAsync(targetUri, { idempotent: false });
          deleted = await checkUriGone(targetUri, item.fileName, item.size, assetId);
        } catch {
          deleted = false;
        }
      }

      // Attempt 3: Lazy MediaLibrary asset lookup for legacy media records lacking mediaAssetId
      if (
        !deleted &&
        !assetId &&
        (item.category === 'image' || item.category === 'video' || item.category === 'audio')
      ) {
        try {
          const matched = await findMatchingMediaLibraryAsset({
            fileName: item.fileName,
            size: item.size,
            category: item.category,
            contentUri: item.uri,
            requestPermission: false,
          });
          if (matched) {
            const res = await MediaLibrary.deleteAssetsAsync([matched.id]);
            if (res) {
              deleted = await checkUriGone(matched.uri, item.fileName, item.size, matched.id);
            }
          }
        } catch {
          // Unable to delete via MediaLibrary fallback
        }
      }

      if (deleted) {
        freedCount += 1;
        freedBytes += item.size;
        await recordActionHistory({
          fileName: item.fileName,
          uri: item.uri,
          size: item.size,
          status: 'cleaned_locally',
          destination: 'Local Space Reclaimed',
        });
      } else {
        failedCount += 1;
      }
    } catch (err) {
      console.warn(`[Cleaner] Failed to delete local file ${item.fileName}:`, err);
      failedCount += 1;
    }

    if (onProgress) {
      onProgress(i + 1, items.length);
    }
  }

  return {
    freedCount,
    freedBytes,
    failedCount,
    blockedCount,
  };
}

export interface CacheAnalysis {
  totalBytes: number;
  fileCount: number;
  chunkBytes: number;
  previewBytes: number;
  otherBytes: number;
}

/**
 * Analyzes disk space consumed by temporary upload chunks, restored preview files, and cache.
 */
export async function analyzeCacheUsage(): Promise<CacheAnalysis> {
  let totalBytes = 0;
  let fileCount = 0;
  let chunkBytes = 0;
  let previewBytes = 0;
  let otherBytes = 0;

  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return { totalBytes: 0, fileCount: 0, chunkBytes: 0, previewBytes: 0, otherBytes: 0 };

    const topFiles = await FileSystem.readDirectoryAsync(cacheDir).catch(() => []);
    for (const f of topFiles) {
      const fullPath = `${cacheDir}${f}`;
      const info = await FileSystem.getInfoAsync(fullPath).catch(() => ({ exists: false } as any));
      if (!info.exists) continue;

      if ((info as any).isDirectory) {
        if (f === 'tdlib_upload') {
          // Scan inside tdlib_upload directory (chunks, etc.)
          const subFiles = await FileSystem.readDirectoryAsync(fullPath).catch(() => []);
          for (const sf of subFiles) {
            const subPath = `${fullPath}/${sf}`;
            const subInfo = await FileSystem.getInfoAsync(subPath).catch(() => ({ exists: false } as any));
            if (subInfo.exists && typeof (subInfo as any).size === 'number') {
              const sz = (subInfo as any).size;
              chunkBytes += sz;
              totalBytes += sz;
              fileCount += 1;
            }
          }
        }
      } else {
        const sz = typeof (info as any).size === 'number' ? (info as any).size : 0;
        if (f.startsWith('restored_')) {
          previewBytes += sz;
        } else {
          otherBytes += sz;
        }
        totalBytes += sz;
        fileCount += 1;
      }
    }
  } catch (err) {
    console.warn('[Cleaner] analyzeCacheUsage error:', err);
  }

  return { totalBytes, fileCount, chunkBytes, previewBytes, otherBytes };
}

/**
 * Purges all temporary upload chunks, restored preview files, and cache from disk.
 */
export async function purgeAppCache(): Promise<{ freedBytes: number; freedFiles: number }> {
  let freedBytes = 0;
  let freedFiles = 0;

  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return { freedBytes: 0, freedFiles: 0 };

    const topFiles = await FileSystem.readDirectoryAsync(cacheDir).catch(() => []);
    for (const f of topFiles) {
      const fullPath = `${cacheDir}${f}`;
      const info = await FileSystem.getInfoAsync(fullPath).catch(() => ({ exists: false } as any));
      if (!info.exists) continue;

      if ((info as any).isDirectory) {
        if (f === 'tdlib_upload') {
          const subFiles = await FileSystem.readDirectoryAsync(fullPath).catch(() => []);
          for (const sf of subFiles) {
            const subPath = `${fullPath}/${sf}`;
            const subInfo = await FileSystem.getInfoAsync(subPath).catch(() => ({ exists: false } as any));
            const sz = subInfo.exists && typeof (subInfo as any).size === 'number' ? (subInfo as any).size : 0;
            await FileSystem.deleteAsync(subPath, { idempotent: true }).catch(() => {});
            freedBytes += sz;
            freedFiles += 1;
          }
        }
      } else if (f.startsWith('restored_') || f.startsWith('tdlib_qr_') || f.endsWith('.tmp')) {
        const sz = typeof (info as any).size === 'number' ? (info as any).size : 0;
        await FileSystem.deleteAsync(fullPath, { idempotent: true }).catch(() => {});
        freedBytes += sz;
        freedFiles += 1;
      }
    }
  } catch (err) {
    console.warn('[Cleaner] purgeAppCache error:', err);
  }

  return { freedBytes, freedFiles };
}
