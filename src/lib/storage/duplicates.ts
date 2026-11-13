import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { computeFastFileHash, extractMediaStoreAssetId } from './fileHelper';

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

/**
 * Scans a list of file URIs to detect duplicates.
 * Phase 1: Groups by exact byte size (instant O(n) filter).
 * Phase 2: Computes SHA-256 sample hash for collisions to confirm identical content.
 */
export async function findLocalDuplicates(
  fileUris: string[],
  onProgress?: (p: ScanDuplicatesProgress) => void
): Promise<DuplicateGroup[]> {
  const sizeMap: Map<number, string[]> = new Map();
  let scannedCount = 0;

  // Phase 1: Size grouping
  for (const uri of fileUris) {
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
    }
    scannedCount++;
    if (scannedCount % 10 === 0) {
      onProgress?.({
        scanned: scannedCount,
        total: fileUris.length,
        duplicatesFound: 0,
      });
    }
  }

  // Phase 2: Hash verification on potential candidates
  const duplicateGroups: DuplicateGroup[] = [];
  let foundCount = 0;

  for (const [size, candidateUris] of sizeMap.entries()) {
    if (candidateUris.length < 2) continue;

    const hashMap: Map<string, DuplicateFile[]> = new Map();

    for (const uri of candidateUris) {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        const name = uri.split('/').pop() || 'unknown';
        const modifiedAt = (info as any).modificationTime ? (info as any).modificationTime * 1000 : Date.now();
        const hash = await computeFastFileHash(uri, size);

        const groupFiles = hashMap.get(hash) || [];
        groupFiles.push({ uri, name, size, modifiedAt });
        hashMap.set(hash, groupFiles);
      } catch {
        // Skip
      }
    }

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

  for (const group of groups) {
    if (group.files.length < 2) continue;

    // Sort files according to strategy
    const sorted = [...group.files].sort((a, b) =>
      keepStrategy === 'oldest' ? a.modifiedAt - b.modifiedAt : b.modifiedAt - a.modifiedAt
    );

    // Keep sorted[0], delete remaining copies
    const redundantCopies = sorted.slice(1);

    for (const copy of redundantCopies) {
      try {
        let deleted = false;
        const assetId =
          extractMediaStoreAssetId(copy.uri) ||
          (copy.uri.startsWith('ph://') ? copy.uri : undefined);

        if (assetId) {
          try {
            const res = await MediaLibrary.deleteAssetsAsync([assetId]);
            if (res) deleted = true;
          } catch {}
        }
        if (!deleted) {
          try {
            await FileSystem.deleteAsync(copy.uri, { idempotent: true });
            deleted = true;
          } catch {}
        }
        if (deleted) {
          deletedCount++;
          freedBytes += group.size;
        } else {
          errors.push(`Failed to delete ${copy.name}: File could not be removed`);
        }
      } catch (err: any) {
        errors.push(`Failed to delete ${copy.name}: ${err?.message || 'Permission denied'}`);
      }
    }
  }

  return { deletedCount, freedBytes, errors };
}

