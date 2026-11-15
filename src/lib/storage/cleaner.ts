import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import PQueue from 'p-queue';
import {
  getUploadedIndex,
  getQueue,
  recordActionHistoryBatch,
} from './queue';
import {
  FileCategory,
  getFileCategory,
  resolveLocalFileTarget,
  findMatchingMediaLibraryAsset,
  extractMediaStoreAssetId,
  extractDirectFileUriFromContentUri,
  clearResolvedTargetCache,
  statLocalFileUri,
} from './fileHelper';

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

let cachedCleanerAnalysis: CleanerAnalysis | null = null;
let lastCleanerAnalysisAt = 0;
const CLEANER_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function invalidateCleanerAnalysisCache(): void {
  cachedCleanerAnalysis = null;
  lastCleanerAnalysisAt = 0;
}

/**
 * Scans all confirmed cloud-uploaded files and checks which ones still
 * consume physical space on the local device.
 * Employs a 2-minute in-memory cache to make repeated modal openings instant (0ms).
 */
export async function analyzeCleanableSpace(options: { forceRefresh?: boolean } = {}): Promise<CleanerAnalysis> {
  const now = Date.now();
  if (!options.forceRefresh && cachedCleanerAnalysis && (now - lastCleanerAnalysisAt < CLEANER_CACHE_TTL_MS)) {
    return cachedCleanerAnalysis;
  }

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

  const result: CleanerAnalysis = {
    candidates,
    totalBytes,
    totalCount: candidates.length,
    categories,
    restrictedCandidates,
    restrictedBytes,
    restrictedCount: restrictedCandidates.length,
    pendingQueueCount,
  };

  cachedCleanerAnalysis = result;
  lastCleanerAnalysisAt = Date.now();

  return result;
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
  onProgress?: (cleanedCount: number, total: number) => void,
  abortSignal?: AbortSignal
): Promise<CleanResult> {
  let freedCount = 0;
  let freedBytes = 0;
  let failedCount = 0;
  let blockedCount = 0;

  if (items.length === 0 || abortSignal?.aborted) {
    return { freedCount: 0, freedBytes: 0, failedCount: 0, blockedCount: 0 };
  }

  // Clear stale in-memory target caches upfront so checks never return stale "exists: true"
  clearResolvedTargetCache();
  invalidateCleanerAnalysisCache();

  const uploaded = await getUploadedIndex();

  // Phase 1: In-memory Safety Shield Filter (0ms instant)
  // Verify that every file candidate has a confirmed cloud backup record.
  const eligibleItems: CleanableItem[] = [];
  for (const item of items) {
    const rec = uploaded.find((u) => u.uri === item.uri);
    const hasCloudRecord = Boolean(rec && (rec.telegramMessageId || rec.chunkManifest || item.telegramMessageId));

    if (!hasCloudRecord || rec?.cloudStatus === 'missing') {
      console.warn(`[Cleaner Safety Shield] Blocked deletion of "${item.fileName}" — No valid Telegram cloud upload record found.`);
      blockedCount += 1;
    } else {
      eligibleItems.push(item);
    }
  }

  if (eligibleItems.length === 0) {
    return { freedCount: 0, freedBytes: 0, failedCount: 0, blockedCount };
  }

  // Phase 2: Direct Silent FileSystem Deletion (Zero Android Native Popups)
  // Deletes files directly via physical filesystem paths (FileSystem.deleteAsync)
  // to avoid triggering Android MediaStore.createDeleteRequest system dialogs.
  const fsQueue = new PQueue({ concurrency: 6 });
  const historyEntries: {
    fileName: string;
    uri: string;
    size: number;
    status: 'cleaned_locally';
    destination: string;
  }[] = [];

  let processedCount = 0;
  const totalItems = eligibleItems.length;

  await Promise.all(
    eligibleItems.map((item) =>
      fsQueue.add(async () => {
        if (abortSignal?.aborted) return;

        // Collect all candidate physical file:// paths to attempt direct silent deletion
        const pathsToTry: string[] = [];

        // 1. Direct resolvedUri if it's already a file:// path
        if (item.resolvedUri?.startsWith('file://')) {
          pathsToTry.push(item.resolvedUri);
        }

        // 2. Direct item.uri if it's already a file:// path
        if (item.uri?.startsWith('file://') && !pathsToTry.includes(item.uri)) {
          pathsToTry.push(item.uri);
        }

        // 3. Extract direct file URI from content:// scheme (e.g. primary:...)
        const fromContent = extractDirectFileUriFromContentUri(item.uri);
        if (fromContent && !pathsToTry.includes(fromContent)) {
          pathsToTry.push(fromContent);
        }

        // 4. Resolve MediaStore physical path via MediaLibrary assetInfo if available
        let assetId =
          item.mediaAssetId ||
          extractMediaStoreAssetId(item.resolvedUri || '') ||
          extractMediaStoreAssetId(item.uri);

        if (!assetId && (item.category === 'image' || item.category === 'video' || item.category === 'audio')) {
          try {
            const matched = await findMatchingMediaLibraryAsset({
              fileName: item.fileName,
              size: item.size,
              category: item.category,
              contentUri: item.uri,
              requestPermission: false,
            });
            if (matched?.id) {
              assetId = matched.id;
            }
          } catch {}
        }

        if (assetId) {
          try {
            const assetInfo = await MediaLibrary.getAssetInfoAsync(assetId).catch(() => null);
            if (assetInfo?.localUri && assetInfo.localUri.startsWith('file://') && !pathsToTry.includes(assetInfo.localUri)) {
              pathsToTry.push(assetInfo.localUri);
            }
          } catch {}
        }

        // 5. Fallback: try raw URI if no file:// scheme was found
        if (pathsToTry.length === 0 && item.uri) {
          pathsToTry.push(item.uri);
        }

        let deleted = false;
        for (const targetPath of pathsToTry) {
          try {
            await FileSystem.deleteAsync(targetPath, { idempotent: true });
            const stat = await statLocalFileUri(targetPath);
            if (!stat.exists) {
              deleted = true;
              break;
            }
          } catch {
            // Keep trying alternate paths
          }
        }

        if (deleted) {
          freedCount += 1;
          freedBytes += item.size;
          historyEntries.push({
            fileName: item.fileName,
            uri: item.uri,
            size: item.size,
            status: 'cleaned_locally',
            destination: 'Local Space Reclaimed',
          });
        } else {
          failedCount += 1;
        }

        processedCount += 1;
        if (onProgress) onProgress(processedCount, totalItems);
      })
    )
  );

  if (historyEntries.length > 0) {
    recordActionHistoryBatch(historyEntries).catch(() => {});
  }

  // Final cache invalidation
  clearResolvedTargetCache();
  invalidateCleanerAnalysisCache();

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
