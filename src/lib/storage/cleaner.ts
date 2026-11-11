import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import {
  getUploadedIndex,
  recordActionHistory,
} from './queue';
import { getFileCategory } from '../scanner/files';

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
 */
export async function executeCleanSpace(
  items: CleanableItem[],
  onProgress?: (cleanedCount: number, total: number) => void
): Promise<CleanResult> {
  let freedCount = 0;
  let freedBytes = 0;
  let failedCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let deleted = false;

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
  };
}
