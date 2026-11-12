/**
 * cloudSync.ts — Telegram Cloud Reconciliation, Real-Time Delete Tracking & Safety Engine
 *
 * Keeps local upload records in sync with the live Telegram Cloud state:
 * 1. Probes message existence (single and batch)
 * 2. Catches remote deletions in real-time via `updateDeleteMessages`
 * 3. Provides two-way deletion (delete directly from Telegram Cloud inside Nimo)
 * 4. Imports existing files from Telegram chat history (Disaster Recovery / Multi-device)
 * 5. Acts as the "Safety Shield" verifying cloud copies before local files are cleaned
 */

import {
  getUploadedIndex,
  saveUploadedIndex,
  UploadedRecord,
  getConfig,
  recordActionHistory,
  removeUploadedRecord,
  updateUploadedRecord,
} from './queue';
import { computeFastFileHash } from './fileHelper';
import { tdLibClient } from '../tdlib/client';

export interface ReconciliationResult {
  total: number;
  synced: number;
  missing: number;
  missingRecords: UploadedRecord[];
}

/**
 * Resolves the numeric chat ID for the user's current backup destination.
 */
async function resolveCurrentChatId(): Promise<number> {
  const config = await getConfig();
  const target = config.uploadToSavedMessages || !config.targetChatId ? 'me' : config.targetChatId;
  return await tdLibClient.resolveTargetChatId(target);
}

/**
 * Probes Telegram Cloud for a single record.
 * Handles both normal files and multi-part chunked archives.
 * Updates the record's cloudStatus and lastVerifiedAt in AsyncStorage.
 */
export async function verifyCloudRecord(
  record: UploadedRecord,
  providedChatId?: number,
): Promise<{ exists: boolean; record: UploadedRecord }> {
  const chatId = providedChatId ?? (await resolveCurrentChatId());

  let exists = false;

  if (record.chunkManifest && record.chunkManifest.parts.length > 0) {
    // Multi-part file: ALL parts must still exist in Telegram Cloud
    const partIds = record.chunkManifest.parts.map((p) => p.telegramMessageId).filter(Boolean);
    if (partIds.length === 0) {
      exists = false;
    } else {
      const batchMap = await tdLibClient.checkMessagesBatch(chatId, partIds);
      exists = partIds.every((id) => batchMap.get(id) === true);
    }
  } else if (record.telegramMessageId) {
    // Normal single-message upload
    exists = await tdLibClient.checkMessageExists(chatId, record.telegramMessageId);
  } else {
    // No message ID recorded (local only or legacy)
    exists = false;
  }

  const updated: UploadedRecord = {
    ...record,
    cloudStatus: exists ? 'synced' : 'missing',
    lastVerifiedAt: Date.now(),
  };

  // Persist updated status
  const index = await getUploadedIndex();
  const idx = index.findIndex((r) => r.uri === record.uri);
  if (idx >= 0) {
    index[idx] = updated;
    await saveUploadedIndex(index);
  }

  return { exists, record: updated };
}

/**
 * Batch reconciles the entire Cloud Explorer catalog against Telegram servers.
 *
 * @param options.forceAll If true, checks every record. If false, only checks
 *                         records older than 12 hours or currently marked missing.
 * @param options.onProgress Progress callback (0–100)
 */
export async function reconcileCloudIndex(options: {
  forceAll?: boolean;
  onProgress?: (percent: number) => void;
} = {}): Promise<ReconciliationResult> {
  const [index, chatId] = await Promise.all([
    getUploadedIndex(),
    resolveCurrentChatId(),
  ]);

  if (index.length === 0) {
    options.onProgress?.(100);
    return { total: 0, synced: 0, missing: 0, missingRecords: [] };
  }

  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const now = Date.now();

  // Identify records needing verification
  const toCheck = options.forceAll
    ? index
    : index.filter((r) => {
        if (!r.lastVerifiedAt) return true;
        if (r.cloudStatus === 'missing') return true;
        return now - r.lastVerifiedAt > TWELVE_HOURS;
      });

  if (toCheck.length === 0) {
    // Everything is fresh
    options.onProgress?.(100);
    const missing = index.filter((r) => r.cloudStatus === 'missing');
    return {
      total: index.length,
      synced: index.length - missing.length,
      missing: missing.length,
      missingRecords: missing,
    };
  }

  // Collect all unique message IDs to probe in batch
  const allMessageIds: number[] = [];
  for (const rec of toCheck) {
    if (rec.chunkManifest?.parts) {
      for (const part of rec.chunkManifest.parts) {
        if (part.telegramMessageId) allMessageIds.push(part.telegramMessageId);
      }
    } else if (rec.telegramMessageId) {
      allMessageIds.push(rec.telegramMessageId);
    }
  }

  // Probe TDLib in batches of up to 50 message IDs
  const resultMap = new Map<number, boolean>();
  const BATCH_SIZE = 50;
  for (let i = 0; i < allMessageIds.length; i += BATCH_SIZE) {
    const chunk = allMessageIds.slice(i, i + BATCH_SIZE);
    const subMap = await tdLibClient.checkMessagesBatch(chatId, chunk);
    for (const [mId, ex] of subMap.entries()) {
      resultMap.set(mId, ex);
    }
    if (options.onProgress) {
      options.onProgress(Math.min(95, Math.round(((i + chunk.length) / allMessageIds.length) * 100)));
    }
  }

  // Update records based on verification probe
  const missingRecords: UploadedRecord[] = [];
  let syncedCount = 0;

  const updatedIndex = index.map((r) => {
    // Check if this record was in the probe list
    const wasChecked = toCheck.some((tc) => tc.uri === r.uri);
    if (!wasChecked) {
      if (r.cloudStatus === 'synced') syncedCount++;
      return r;
    }

    let exists = false;
    if (r.chunkManifest?.parts && r.chunkManifest.parts.length > 0) {
      exists = r.chunkManifest.parts.every((p) => resultMap.get(p.telegramMessageId) === true);
    } else if (r.telegramMessageId) {
      exists = resultMap.get(r.telegramMessageId) === true;
    }

    const updated: UploadedRecord = {
      ...r,
      cloudStatus: exists ? 'synced' : 'missing',
      lastVerifiedAt: now,
    };

    if (exists) {
      syncedCount++;
    } else {
      missingRecords.push(updated);
    }

    return updated;
  });

  await saveUploadedIndex(updatedIndex);
  options.onProgress?.(100);

  return {
    total: updatedIndex.length,
    synced: syncedCount,
    missing: missingRecords.length,
    missingRecords,
  };
}

/**
 * Deletes a file permanently from Telegram Cloud.
 * Handles single files and all parts of multi-part chunked files.
 * Removes the record from the local uploaded index.
 */
export async function deleteCloudRecord(record: UploadedRecord): Promise<boolean> {
  const chatId = await resolveCurrentChatId();

  // Determine which message IDs need deletion
  const messageIdsToDelete: number[] = [];
  if (record.chunkManifest?.parts) {
    for (const part of record.chunkManifest.parts) {
      if (part.telegramMessageId) messageIdsToDelete.push(part.telegramMessageId);
    }
  } else if (record.telegramMessageId) {
    messageIdsToDelete.push(record.telegramMessageId);
  }

  let cloudDeleted = true;
  if (messageIdsToDelete.length > 0) {
    cloudDeleted = await tdLibClient.deleteCloudMessages(chatId, messageIdsToDelete, true);
  }

  // Remove from local database
  await removeUploadedRecord(record.uri);

  // Record action in history
  await recordActionHistory({
    fileName: record.fileName,
    uri: record.uri,
    size: record.size,
    status: 'cleaned_locally',
    destination: `Telegram Cloud #${messageIdsToDelete.join(',')}`,
  }).catch(() => {});

  return cloudDeleted;
}

/**
 * Disaster Recovery / Reverse Discovery:
 * Scans the Telegram destination chat history and imports existing files into Cloud Explorer.
 */
export async function importFromTelegramHistory(options: {
  chatId?: string | number;
  limit?: number;
  onProgress?: (found: number) => void;
} = {}): Promise<{ imported: number; totalFound: number }> {
  const index = await getUploadedIndex();
  const chatId = options.chatId !== undefined
    ? await tdLibClient.resolveTargetChatId(String(options.chatId))
    : await resolveCurrentChatId();

  const existingMsgIds = new Set<number>();
  for (const r of index) {
    if (r.telegramMessageId) existingMsgIds.add(r.telegramMessageId);
    if (r.chunkManifest?.parts) {
      for (const p of r.chunkManifest.parts) {
        if (p.telegramMessageId) existingMsgIds.add(p.telegramMessageId);
      }
    }
  }

  const maxLimit = options.limit || 200;
  const pageSize = 50;
  let fromMessageId = 0;
  let fetchedTotal = 0;
  const newRecords: UploadedRecord[] = [];

  while (fetchedTotal < maxLimit) {
    const batch = await tdLibClient.getChatHistory(chatId, fromMessageId, Math.min(pageSize, maxLimit - fetchedTotal), 0);
    if (!Array.isArray(batch) || batch.length === 0) break;
    fetchedTotal += batch.length;

    for (const msg of batch) {
      if (!msg || !msg.id) continue;
      if (existingMsgIds.has(msg.id)) continue;

      const content = msg.content;
      if (!content) continue;

      const captionText = content.caption?.text || '';
      if (captionText.includes('[NIMO_CLOUD_PROFILE_V1]')) continue;

      let fileName = `cloud_file_${msg.id}`;
      let size = 0;
      let isDoc = false;

      if (content['@type'] === 'messageDocument' && content.document) {
        isDoc = true;
        fileName = content.document.file_name || fileName;
        size = content.document.document?.size || content.document.size || 0;
      } else if (content['@type'] === 'messageVideo' && content.video) {
        isDoc = true;
        fileName = content.video.file_name || `video_${msg.id}.mp4`;
        size = content.video.video?.size || content.video.size || 0;
      } else if (content['@type'] === 'messageAudio' && content.audio) {
        isDoc = true;
        fileName = content.audio.file_name || `audio_${msg.id}.mp3`;
        size = content.audio.audio?.size || content.audio.size || 0;
      }

      if (fileName === 'nimo_cloud_profile_v1.json') continue;

      if (isDoc) {
        existingMsgIds.add(msg.id);
        newRecords.push({
          uri: `tg://${chatId}/${msg.id}`,
          fileName,
          size,
          uploadedAt: (msg.date || Date.now() / 1000) * 1000,
          telegramMessageId: msg.id,
          cloudStatus: 'synced',
          lastVerifiedAt: Date.now(),
        });
        options.onProgress?.(newRecords.length);
      }
    }

    const lastMsg = batch[batch.length - 1];
    if (!lastMsg?.id || lastMsg.id === fromMessageId) break;
    fromMessageId = lastMsg.id;
    if (batch.length < 20 && fetchedTotal >= pageSize) break;
  }

  if (newRecords.length > 0) {
    await saveUploadedIndex([...index, ...newRecords]);
  }

  return { imported: newRecords.length, totalFound: fetchedTotal };
}

/**
 * Runs a pre-upload sync on the destination Telegram chat:
 * 1. Reconciles stale cloud records to purge missing/deleted messages
 * 2. Imports new cloud files uploaded from other sessions/devices
 */
export async function syncDestinationBeforeUpload(
  targetChat?: string,
  onProgress?: (status: string) => void
): Promise<{ importedCount: number; purgedCount: number }> {
  try {
    onProgress?.('Syncing with Telegram cloud...');
    const chatId = targetChat
      ? await tdLibClient.resolveTargetChatId(targetChat)
      : await resolveCurrentChatId();

    const recon = await reconcileCloudIndex({ forceAll: false });
    const imported = await importFromTelegramHistory({ chatId, limit: 100 });
    return {
      importedCount: imported.imported,
      purgedCount: recon.missing,
    };
  } catch (err) {
    console.warn('[CloudSync] Pre-upload sync failed (non-fatal):', err);
    return { importedCount: 0, purgedCount: 0 };
  }
}

export interface CloudConflictMatch {
  conflictType: 'exact_hash' | 'name_size_match';
  record: UploadedRecord;
}

/**
 * Detects whether an item about to be uploaded already exists in Telegram Cloud.
 * Matches first by fast SHA-256 hash + exact size, then by fileName + exact size,
 * and confirms the candidate message still exists live via TDLib.
 */
export async function findCloudConflict(
  file: { uri: string; fileName: string; size: number; hash?: string },
  targetChat?: string
): Promise<CloudConflictMatch | null> {
  try {
    const hash = file.hash || (file.uri && file.size > 0 ? await computeFastFileHash(file.uri, file.size) : undefined);
    const index = await getUploadedIndex();
    const candidates: { conflictType: CloudConflictMatch['conflictType']; record: UploadedRecord }[] = [];

    if (hash) {
      const exactMatch = index.find(
        (r) => r.cloudStatus !== 'missing' && r.size === file.size && r.hash === hash
      );
      if (exactMatch) {
        candidates.push({ conflictType: 'exact_hash', record: exactMatch });
      }
    }

    const lowerName = file.fileName.toLowerCase();
    const nameSizeMatch = index.find(
      (r) =>
        r.cloudStatus !== 'missing' &&
        r.fileName.toLowerCase() === lowerName &&
        r.size === file.size &&
        !candidates.some((c) => c.record.uri === r.uri)
    );
    if (nameSizeMatch) {
      candidates.push({ conflictType: 'name_size_match', record: nameSizeMatch });
    }

    if (candidates.length === 0) return null;

    const chatId = targetChat
      ? await tdLibClient.resolveTargetChatId(targetChat)
      : await resolveCurrentChatId();

    for (const candidate of candidates) {
      if (!candidate.record.telegramMessageId) continue;
      const verified = await verifyCloudRecord(candidate.record, chatId);
      if (verified.exists) {
        // Backfill hash if missing on the existing record and matched by name+size
        if (hash && !verified.record.hash) {
          await updateUploadedRecord(verified.record.uri, { hash });
          verified.record.hash = hash;
        }
        return { conflictType: candidate.conflictType, record: verified.record };
      }
    }
  } catch (err) {
    console.warn('[CloudSync] findCloudConflict check failed (non-fatal):', err);
  }
  return null;
}

/**
 * Attaches a real-time listener for TDLib `updateDeleteMessages` events.
 * When the user or Telegram deletes messages, matching records in
 * Cloud Explorer are automatically marked as `missing`.
 *
 * @returns Unsubscribe function
 */
export function startRealtimeDeleteListener(
  onDeleteDetected?: (deletedCount: number) => void,
): () => void {
  return tdLibClient.addUpdateListener(async (type, parsed) => {
    if (type !== 'updateDeleteMessages' && parsed?.['@type'] !== 'updateDeleteMessages') {
      return;
    }

    const messageIds: number[] = parsed.message_ids || parsed.messageIds || [];
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;

    const deletedSet = new Set(messageIds);
    const index = await getUploadedIndex();
    let changeCount = 0;

    const updated = index.map((r) => {
      // Check single message
      if (r.telegramMessageId && deletedSet.has(r.telegramMessageId)) {
        changeCount++;
        return { ...r, cloudStatus: 'missing' as const, lastVerifiedAt: Date.now() };
      }

      // Check multi-part chunks
      if (r.chunkManifest?.parts) {
        const hasDeletedPart = r.chunkManifest.parts.some((p) => deletedSet.has(p.telegramMessageId));
        if (hasDeletedPart) {
          changeCount++;
          return { ...r, cloudStatus: 'missing' as const, lastVerifiedAt: Date.now() };
        }
      }

      return r;
    });

    if (changeCount > 0) {
      await saveUploadedIndex(updated);
      console.log(`[CloudSync] Live detected ${changeCount} deleted message(s) in Telegram.`);
      onDeleteDetected?.(changeCount);
    }
  });
}
