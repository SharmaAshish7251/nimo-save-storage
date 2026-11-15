import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import PQueue from 'p-queue';
import {
  computeFastFileHash,
  extractMediaStoreAssetId,
  extractDirectFileUriFromContentUri,
} from './fileHelper';

export { computeFastFileHash };

export interface DuplicateFile {
  uri: string;
  name: string;
  size: number;
  modifiedAt: number;
}

export interface DuplicateGroup {
  id: string;
  hash: string;
  size: number;
  files: DuplicateFile[];
}

export interface ScanDuplicatesProgress {
  scanned: number;
  total: number;
  duplicatesFound: number;
}

// In-memory caching for hash calculations and duplicate scan results
const fastHashCache = new Map<string, string>();
let cachedDuplicateGroups: DuplicateGroup[] | null = null;
let lastDuplicateScanAt = 0;
const DUPLICATES_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function invalidateDuplicateCache(): void {
  cachedDuplicateGroups = null;
  lastDuplicateScanAt = 0;
  fastHashCache.clear();
}

/**
 * Scans a list of file URIs to detect duplicates.
 * Phase 1: Groups by exact byte size (instant O(n) filter).
 * Phase 2: Computes SHA-256 sample hash for collisions with concurrency & in-memory caching.
 */
export async function findLocalDuplicates(
  fileUris: string[],
  onProgress?: (p: ScanDuplicatesProgress) => void,
  options: { forceRefresh?: boolean } = {}
): Promise<DuplicateGroup[]> {
  const now = Date.now();
  if (!options.forceRefresh && cachedDuplicateGroups && (now - lastDuplicateScanAt < DUPLICATES_CACHE_TTL_MS)) {
    return cachedDuplicateGroups;
  }

  const sizeMap: Map<number, string[]> = new Map();
  let scannedCount = 0;

  // Phase 1: Size grouping (parallelized with PQueue concurrency 12)
  const pQueue = new PQueue({ concurrency: 12 });
  const tasks = fileUris.map((uri) =>
    pQueue.add(async () => {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists && !info.isDirectory) {
          const size = (info as any).size ?? 0;
          if (size > 0) {
            const list = sizeMap.get(size) || [];
            list.push(uri);
            sizeMap.set(size, list);
          }
        }
      } catch {
        // Inaccessible or deleted file
      } finally {
        scannedCount++;
        if (scannedCount % 15 === 0 || scannedCount === fileUris.length) {
          onProgress?.({
            scanned: scannedCount,
            total: fileUris.length,
            duplicatesFound: 0,
          });
        }
      }
    })
  );
  await Promise.all(tasks);

  // Phase 2: Hash verification on potential candidates with parallel concurrency
  const duplicateGroups: DuplicateGroup[] = [];
  let foundCount = 0;
  const hashQueue = new PQueue({ concurrency: 6 });

  for (const [size, candidateUris] of sizeMap.entries()) {
    if (candidateUris.length < 2) continue;

    const hashMap: Map<string, DuplicateFile[]> = new Map();

    const hashTasks = candidateUris.map((uri) =>
      hashQueue.add(async () => {
        try {
          const info = await FileSystem.getInfoAsync(uri);
          const name = uri.split('/').pop() || 'unknown';
          const modifiedAt = (info as any).modificationTime ? (info as any).modificationTime * 1000 : Date.now();

          const cacheKey = `${uri}_${size}_${modifiedAt}`;
          let hash: string | null = fastHashCache.get(cacheKey) || null;
          if (!hash) {
            hash = await computeFastFileHash(uri, size);
            if (hash) {
              fastHashCache.set(cacheKey, hash);
            }
          }
          if (!hash) return;

          const groupFiles = hashMap.get(hash) || [];
          groupFiles.push({ uri, name, size, modifiedAt });
          hashMap.set(hash, groupFiles);
        } catch {
          // Skip
        }
      })
    );
    await Promise.all(hashTasks);

    for (const [hash, files] of hashMap.entries()) {
      if (files.length > 1) {
        foundCount += files.length - 1;
        duplicateGroups.push({
          id: `${size}_${hash.substring(0, 12)}`,
          hash,
          size,
          files,
        });
      }
    }

    onProgress?.({
      scanned: scannedCount,
      total: fileUris.length,
      duplicatesFound: foundCount,
    });
  }

  cachedDuplicateGroups = duplicateGroups;
  lastDuplicateScanAt = Date.now();

  return duplicateGroups;
}

/**
 * Safely deletes duplicate files according to the chosen strategy,
 * keeping the primary copy (oldest or newest).
 */
export async function deleteDuplicates(
  groups: DuplicateGroup[],
  keepStrategy: 'oldest' | 'newest' = 'oldest'
): Promise<{ deletedCount: number; freedBytes: number; errors: string[] }> {
  let deletedCount = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  const allRedundantMedia: { copy: DuplicateFile; groupSize: number; assetId: string }[] = [];
  const allRedundantDirectFs: { copy: DuplicateFile; groupSize: number }[] = [];

  for (const group of groups) {
    if (group.files.length < 2) continue;

    // Sort files according to strategy
    const sorted = [...group.files].sort((a, b) =>
      keepStrategy === 'oldest' ? a.modifiedAt - b.modifiedAt : b.modifiedAt - a.modifiedAt
    );

    // Keep sorted[0], delete remaining copies
    const redundantCopies = sorted.slice(1);

    for (const copy of redundantCopies) {
      const assetId =
        extractMediaStoreAssetId(copy.uri) ||
        (copy.uri.startsWith('ph://') ? copy.uri : undefined);

      if (assetId) {
        allRedundantMedia.push({ copy, groupSize: group.size, assetId });
      } else {
        allRedundantDirectFs.push({ copy, groupSize: group.size });
      }
    }
  }

  // 1. Try silent direct FileSystem deletion first for all media duplicates
  const remainingMedia: typeof allRedundantMedia = [];
  for (const item of allRedundantMedia) {
    let deleted = false;
    let targetPath = item.copy.uri;
    if (!targetPath.startsWith('file://')) {
      const fromContent = extractDirectFileUriFromContentUri(targetPath);
      if (fromContent) {
        targetPath = fromContent;
      } else if (item.assetId) {
        try {
          const assetInfo = await MediaLibrary.getAssetInfoAsync(item.assetId).catch(() => null);
          if (assetInfo?.localUri && assetInfo.localUri.startsWith('file://')) {
            targetPath = assetInfo.localUri;
          }
        } catch {}
      }
    }
    if (targetPath.startsWith('file://')) {
      try {
        await FileSystem.deleteAsync(targetPath, { idempotent: true });
        deleted = true;
      } catch {
        deleted = false;
      }
    }
    if (deleted) {
      deletedCount++;
      freedBytes += item.groupSize;
    } else {
      remainingMedia.push(item);
    }
  }

  // 1b. Fallback: only if direct deletion couldn't remove all media, batch delete remaining
  if (remainingMedia.length > 0) {
    const assetIdSet = new Set<string>();
    remainingMedia.forEach((m) => assetIdSet.add(m.assetId));
    const allAssetIds = Array.from(assetIdSet);

    try {
      const res = await MediaLibrary.deleteAssetsAsync(allAssetIds);
      if (res) {
        for (const item of remainingMedia) {
          deletedCount++;
          freedBytes += item.groupSize;
        }
      } else {
        errors.push('Permission to delete media duplicates was cancelled.');
      }
    } catch (err: any) {
      errors.push(`Media batch delete error: ${err?.message || 'Permission denied'}`);
    }
  }

  // 2. Delete non-media filesystem copies in parallel
  for (const { copy, groupSize } of allRedundantDirectFs) {
    try {
      await FileSystem.deleteAsync(copy.uri, { idempotent: true });
      deletedCount++;
      freedBytes += groupSize;
    } catch (err: any) {
      errors.push(`Failed to delete ${copy.name}: ${err?.message || 'Unable to remove'}`);
    }
  }

  if (deletedCount > 0) {
    invalidateDuplicateCache();
  }

  return { deletedCount, freedBytes, errors };
}

