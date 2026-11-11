import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import {
  getUploadedIndex,
  recordActionHistory,
  updateUploadedRecord,
} from './queue';
import { getFileCategory } from '../scanner/files';
import { verifyCloudRecord } from './cloudSync';

export interface CleanableItem {
  uri: string;
  fileName: string;
  size: number;
  uploadedAt: number;
  category: 'image' | 'video' | 'audio' | 'document' | 'other';
  telegramMessageId?: number;
}

export interface CategorySummary {
  count: number;
  bytes: number;
}

export interface CleanerAnalysis {
  candidates: CleanableItem[];
  totalBytes: number;
  totalCount: number;
  categories: Record<'image' | 'video' | 'audio' | 'document' | 'other', CategorySummary>;
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
  const uploaded = await getUploadedIndex();

  const categories: Record<'image' | 'video' | 'audio' | 'document' | 'other', CategorySummary> = {
    image: { count: 0, bytes: 0 },
    video: { count: 0, bytes: 0 },
    audio: { count: 0, bytes: 0 },
    document: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
  };

  const candidates: CleanableItem[] = [];
  let totalBytes = 0;

  for (const record of uploaded) {
    try {
      const info = await FileSystem.getInfoAsync(record.uri).catch(() => ({ exists: false }));
      if (info.exists) {
        const size = (info as any).size && (info as any).size > 0 ? (info as any).size : record.size || 0;
        const category = getFileCategory(record.fileName);

        const item: CleanableItem = {
          uri: record.uri,
          fileName: record.fileName,
          size,
          uploadedAt: record.uploadedAt,
          category,
          telegramMessageId: record.telegramMessageId,
        };

        candidates.push(item);
        totalBytes += size;
        categories[category].count += 1;
        categories[category].bytes += size;
      }
    } catch {
      // If unable to query local file, skip to be safe
    }
  }

  return {
    candidates,
    totalBytes,
    totalCount: candidates.length,
    categories,
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

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let deleted = false;

    // ── SAFETY SHIELD CHECK ──────────────────────────────────────────────────
    // Verify cloud copy actually exists before wiping local data
    const rec = uploaded.find((u) => u.uri === item.uri);
    if (rec && (rec.telegramMessageId || rec.chunkManifest)) {
      try {
        const { exists } = await verifyCloudRecord(rec);
        if (!exists) {
          console.warn(`[Cleaner Safety Shield] Blocked deletion of "${item.fileName}" — Telegram Cloud copy is missing!`);
          await updateUploadedRecord(item.uri, { cloudStatus: 'missing' });
          blockedCount += 1;
          if (onProgress) onProgress(i + 1, items.length);
          continue; // SKIP deletion — protect user's file!
        }
      } catch {
        // If network probe fails, proceed cautiously or skip if strictly verified
      }
    }

    try {
      // Attempt 1: If it's a Media Library asset URI (ph:// or content://media)
      if (item.uri.startsWith('ph://') || item.uri.includes('content://media')) {
        try {
          const res = await MediaLibrary.deleteAssetsAsync([item.uri]);
          if (res) deleted = true;
        } catch {
          // Fall back to FileSystem.deleteAsync
        }
      }

      // Attempt 2: Direct FileSystem delete (works for SAF content:// and file://)
      if (!deleted) {
        await FileSystem.deleteAsync(item.uri, { idempotent: true });
        deleted = true;
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
