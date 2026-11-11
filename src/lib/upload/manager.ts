import PQueue from 'p-queue';
import {
  getQueue,
  saveQueue,
  QueueItem,
  getConfig,
  recordActionHistory,
  removeFromQueue,
  clearAllQueue,
  resetItemToPending,
  completeUploadAtomically,
  saveChunkManifest,
  formatFileSize,
} from '../storage/queue';
import { tdLibClient } from '../tdlib/client';
import { getFileInfo } from '../storage/fileHelper';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { splitFileIntoChunks, needsChunking, cleanupChunks } from './chunker';
import type { ChunkManifest } from '../storage/reassembler';
import { uploadNotificationService } from '../notifications/uploadNotificationService';
import { vaultService } from '../crypto/vault';

export interface ProcessQueueResult {
  total: number;
  uploaded: number;
  failed: number;
  errors: string[];
  uploadedBytes?: number;
}

const FREE_TIER_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB - Free Telegram limit
const PREMIUM_TIER_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4GB - Telegram Premium limit

export class UploadManager {
  private queue: any;
  private isRunning = false;
  private progressTrack: Record<string, { bytes: number; time: number }> = {};
  // Fix 1.6: In-memory progress cache to avoid AsyncStorage thrashing
  private inMemoryProgress: Map<string, { progress: number; speedKbps: number }> = new Map();
  private totalBatchItems = 0;
  private completedBatchItems = 0;
  private totalBatchBytes = 0;
  private uploadedBatchBytes = 0;

  /**
   * Returns live progress for all currently-uploading items.
   * The UI merges this on top of the AsyncStorage-backed queue items,
   * so progress bars update smoothly without any extra disk I/O.
   */
  public getLiveProgress(): Map<string, { progress: number; speedKbps: number }> {
    return this.inMemoryProgress;
  }

  /**
   * Returns whether an upload session is currently active.
   * Lets the UI decide whether to show a live-upload spinner.
   */
  public get isActive(): boolean {
    return this.isRunning;
  }
  
  constructor(concurrency: number = 3) {
    this.queue = new PQueue({ concurrency });
  }
  
  async setConcurrency(concurrency: number) {
    this.queue.concurrency = concurrency;
  }
  
  async checkNetworkConditions(forceManual = false): Promise<{ canUpload: boolean; reason?: string }> {
    const netInfo = await NetInfo.fetch();
    if (!(netInfo as any).isConnected) {
      return { canUpload: false, reason: 'NO_INTERNET: No internet connection detected. Please check WiFi or mobile data.' };
    }
    
    if (!forceManual) {
      const config = await getConfig();
      if (config.wifiOnly && (netInfo as any).type !== 'wifi') {
        return { canUpload: false, reason: 'WIFI_ONLY: Upload paused because WiFi-only is enabled in Settings.' };
      }
    }
    
    return { canUpload: true };
  }
  
  async processQueue(options: { forceManual?: boolean } = {}): Promise<ProcessQueueResult> {
    if (this.isRunning) {
      throw new Error('Upload is already in progress.');
    }
    this.isRunning = true;
    
    try {
      // 1. Verify Telegram authentication first
      const loggedIn = await tdLibClient.isLoggedIn().catch(() => false);
      if (!loggedIn) {
        throw new Error('NOT_LOGGED_IN: You are not connected to Telegram. Please connect your Telegram account first.');
      }

      // 2. Check network conditions
      const netCheck = await this.checkNetworkConditions(options.forceManual ?? false);
      if (!netCheck.canUpload) {
        throw new Error(netCheck.reason || 'Network conditions not met for upload.');
      }
      
      // 3. Check queue for pending items
      const queueItems = await getQueue();
      const pendingItems = queueItems.filter((item: QueueItem) => item.status === 'pending');
      
      if (pendingItems.length === 0) {
        const failedItems = queueItems.filter((item: QueueItem) => item.status === 'failed');
        if (failedItems.length > 0) {
          throw new Error(`ALL_FAILED: All ${failedItems.length} file(s) in queue previously failed. Tap "Retry" on a file to try again.`);
        }
        throw new Error('EMPTY_QUEUE: Queue is empty. Please select or scan files first.');
      }

      const config = await getConfig();
      this.setConcurrency(config.concurrency || 3);
      
      this.totalBatchItems = pendingItems.length;
      this.completedBatchItems = 0;
      this.totalBatchBytes = pendingItems.reduce((acc: number, it: QueueItem) => acc + (it.size || 0), 0);
      this.uploadedBatchBytes = 0;

      // Start initial progress notification
      uploadNotificationService.showUploadProgress(0, this.totalBatchItems, 0, 0, 0).catch(() => {});

      let uploadedCount = 0;
      let failedCount = 0;
      const errorMessages: string[] = [];

      for (const item of pendingItems) {
        this.queue.add(async () => {
          try {
            await this.uploadItem(item);
            uploadedCount++;
            this.completedBatchItems++;
            this.uploadedBatchBytes += (item.size || 0);
            const batchPercent = this.totalBatchBytes > 0
              ? Math.round((this.uploadedBatchBytes / this.totalBatchBytes) * 100)
              : Math.round((this.completedBatchItems / this.totalBatchItems) * 100);
            uploadNotificationService.showUploadProgress(
              this.completedBatchItems,
              this.totalBatchItems,
              batchPercent,
              0,
              0
            ).catch(() => {});
          } catch (err: any) {
            failedCount++;
            const msg = err.message || 'Upload failed';
            if (!errorMessages.includes(msg)) {
              errorMessages.push(msg);
            }
          }
        });
      }
      
      await this.queue.onIdle();

      await uploadNotificationService.showUploadComplete(uploadedCount, this.uploadedBatchBytes);

      return {
        total: pendingItems.length,
        uploaded: uploadedCount,
        failed: failedCount,
        errors: errorMessages,
        uploadedBytes: this.uploadedBatchBytes,
      };
    } finally {
      await uploadNotificationService.dismissProgress();
      this.isRunning = false;
    }
  }

  async uploadSingleItem(item: QueueItem): Promise<void> {
    const loggedIn = await tdLibClient.isLoggedIn().catch(() => false);
    if (!loggedIn) {
      throw new Error('NOT_LOGGED_IN: You are not connected to Telegram. Please connect your Telegram account first.');
    }

    const netCheck = await this.checkNetworkConditions(true);
    if (!netCheck.canUpload) {
      throw new Error(netCheck.reason || 'No internet connection.');
    }

    await this.uploadItem(item);
  }

  async retryItem(id: string): Promise<void> {
    const item = await resetItemToPending(id);
    if (!item) {
      throw new Error('Item not found in queue');
    }
    await this.uploadSingleItem(item);
  }
  
  private async uploadItem(item: QueueItem): Promise<void> {
    const startTime = Date.now();
    try {
      await this.updateItemStatus(item.id, 'uploading', 0, undefined, startTime);
      
      const fileInfo = await getFileInfo(item.uri);
      if (!fileInfo.exists && !item.uri.startsWith('content://')) {
        throw new Error('File does not exist or cannot be accessed');
      }

      // Fix 2.2: Use actual file size from disk, overriding stale cached value
      const actualSize = fileInfo.size > 0 ? fileInfo.size : item.size;

      // Dynamically determine max upload limit based on Telegram Premium status
      let isPremium = false;
      try {
        const me = await tdLibClient.getMe();
        isPremium = Boolean(me?.is_premium || (me as any)?.isPremium);
      } catch {
        // Fallback to free tier limit if user info cannot be fetched
      }

      const config = await getConfig();
      let targetChat = config.uploadToSavedMessages || !config.targetChatId ? 'me' : config.targetChatId;

      // Categorical multi-channel routing if enabled
      if (config.multiChannelRouting) {
        const mime = item.mimeType || '';
        const ext = (item.fileName.split('.').pop() || '').toLowerCase();
        const isPhoto = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext);
        const isVideo = mime.startsWith('video/') || ['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp'].includes(ext);

        if (isPhoto && config.photoChannelId) {
          targetChat = config.photoChannelId;
        } else if (isVideo && config.videoChannelId) {
          targetChat = config.videoChannelId;
        } else if (!isPhoto && !isVideo && config.documentChannelId) {
          targetChat = config.documentChannelId;
        }
      }

      // ── Multi-part chunking for free-tier accounts with large files ──────
      // Triggered when file > 1.95 GB on a free Telegram account.
      if (!isPremium && actualSize && needsChunking(actualSize)) {
        await this.uploadItemAsChunks(item, actualSize, targetChat, config, startTime);
        return;
      }

      const maxLimitBytes = isPremium ? PREMIUM_TIER_MAX_BYTES : FREE_TIER_MAX_BYTES;
      if (actualSize && actualSize > maxLimitBytes) {
        const sizeMb = Math.round(actualSize / 1024 / 1024);
        if (!isPremium && actualSize <= PREMIUM_TIER_MAX_BYTES) {
          throw new Error(
            `File size (${(actualSize / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds the 2 GB limit for Free Telegram accounts. Telegram Premium is required for up to 4 GB uploads.`
          );
        } else {
          throw new Error(
            `File size (${sizeMb} MB) exceeds Telegram's maximum upload limit of ${isPremium ? '4 GB' : '2 GB'}.`
          );
        }
      }
      
      let result: any;
      const onUploadProgress = (progress: number) => {
        const now = Date.now();
        if (!this.progressTrack[item.id]) {
          this.progressTrack[item.id] = { bytes: 0, time: now };
        }
        const actualSize = fileInfo.size > 0 ? fileInfo.size : item.size || 0;
        const uploadedBytes = Math.round(progress * actualSize);
        const last = this.progressTrack[item.id];
        const deltaBytes = uploadedBytes - last.bytes;
        const deltaTime = (now - last.time) / 1000;
        let speedKbps = 0;
        if (deltaTime > 0 && deltaBytes > 0) {
          speedKbps = (deltaBytes / 1024) / deltaTime;
        }
        this.progressTrack[item.id] = { bytes: uploadedBytes, time: now };
        // Fix 1.6: Only update in-memory progress — no AsyncStorage writes during progress
        this.inMemoryProgress.set(item.id, { progress: Math.round(progress * 100), speedKbps: Math.round(speedKbps) });

        // Update live sticky notification with speed and ETA
        const currentBatchBytes = this.uploadedBatchBytes + uploadedBytes;
        const totalPercent = this.totalBatchBytes > 0
          ? Math.round((currentBatchBytes / this.totalBatchBytes) * 100)
          : Math.round(progress * 100);
        const remainingBytes = Math.max(0, this.totalBatchBytes - currentBatchBytes);
        const etaSeconds = speedKbps > 0 ? Math.round((remainingBytes / 1024) / speedKbps) : 0;
        uploadNotificationService.showUploadProgress(
          this.completedBatchItems + 1,
          this.totalBatchItems,
          totalPercent,
          speedKbps,
          etaSeconds
        ).catch(() => {});
      };

      let uploadUri = item.uri;
      let uploadFileName = item.fileName;
      let tempVaultPath: string | null = null;

      if (config.vaultEnabled) {
        const hasKey = await vaultService.hasVaultKey().catch(() => false);
        if (hasKey) {
          const vaultDir = `${FileSystem.cacheDirectory}vault_upload/`;
          await FileSystem.makeDirectoryAsync(vaultDir, { intermediates: true }).catch(() => {});
          tempVaultPath = `${vaultDir}${Date.now()}_${item.fileName}.enc`;
          try {
            await vaultService.encryptFile(item.uri, tempVaultPath);
            uploadUri = tempVaultPath;
            uploadFileName = `${item.fileName}.enc`;
            console.log(`[UploadManager] Encrypted ${item.fileName} with AES-256 vault`);
          } catch (encErr) {
            console.warn('[UploadManager] Encryption error, falling back to direct upload:', encErr);
            tempVaultPath = null;
          }
        }
      }

      console.log('[UploadManager] Uploading via native TDLib MTProto engine');
      try {
        result = await tdLibClient.sendFile(uploadUri, uploadFileName, targetChat, onUploadProgress);
      } finally {
        if (tempVaultPath) {
          await FileSystem.deleteAsync(tempVaultPath, { idempotent: true }).catch(() => {});
        }
      }

      const durationMs = Date.now() - startTime;

      const destName =
        config.targetChatTitle ||
        (targetChat === 'me' ? 'Saved Messages' : String(targetChat));

      // Atomically update queue, uploaded index, and history in parallel (3 reads + 3 writes)
      // instead of 5 sequential read+write pairs — critical for 100+ concurrent uploads
      await completeUploadAtomically({
        queueId: item.id,
        uri: item.uri,
        fileName: item.fileName,
        size: actualSize ?? item.size,
        telegramMessageId: result?.id,
        uploadedAt: Date.now(),
        uploadDurationMs: durationMs,
        destination: destName,
      });

      // Clean up in-memory progress tracking
      this.inMemoryProgress.delete(item.id);
      delete this.progressTrack[item.id];

      console.log(`Uploaded ${item.fileName} successfully in ${(durationMs / 1000).toFixed(1)}s`);
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      console.error(`Failed to upload ${item.fileName}:`, error);
      uploadNotificationService.showUploadError(item.fileName, error.message || 'Upload failed').catch(() => {});
      await this.updateItemStatus(item.id, 'failed', item.progress, error.message, undefined, undefined, durationMs);

      try {
        const config = await getConfig();
        const targetChat =
          config.uploadToSavedMessages || !config.targetChatId
            ? 'me'
            : config.targetChatId;
        const destName =
          config.targetChatTitle ||
          (targetChat === 'me' ? 'Saved Messages' : String(targetChat));

        await recordActionHistory({
          fileName: item.fileName,
          uri: item.uri,
          size: item.size,
          status: 'failed',
          destination: destName,
          uploadDurationMs: durationMs,
          error: error.message || 'Upload failed',
        });
      } catch {}

      throw error;
    }
  }

  /**
   * Splits a large file into 1.95 GB chunks and uploads each part sequentially
   * to Telegram, with a human-readable caption containing restoration instructions.
   * After all parts are sent, saves a ChunkManifest to AsyncStorage so the
   * Cloud Explorer can present the file as a single combined entry.
   */
  private async uploadItemAsChunks(
    item: QueueItem,
    actualSize: number,
    targetChat: string,
    config: Awaited<ReturnType<typeof getConfig>>,
    startTime: number,
  ): Promise<void> {
    let chunkPaths: string[] = [];
    try {
      const destName =
        config.targetChatTitle ||
        (targetChat === 'me' ? 'Saved Messages' : String(targetChat));

      // 1. Split the file into chunk files in the app cache directory
      console.log(`[UploadManager] Starting chunk split for ${item.fileName} (${(actualSize / (1024 ** 3)).toFixed(2)} GB)`);
      await this.updateItemStatus(item.id, 'uploading', 1, undefined, startTime);

      const { chunkPaths: paths, totalParts } = await splitFileIntoChunks(item.uri, item.fileName);
      chunkPaths = paths;

      const manifestParts: ChunkManifest['parts'] = [];

      // 2. Upload each chunk sequentially
      for (let i = 0; i < chunkPaths.length; i++) {
        const partNumber = i + 1;
        const chunkPath = chunkPaths[i];

        // Show overall progress: splitting counts as 5%, each part gets an equal share of the rest
        const baseProgress = 5 + Math.round((i / totalParts) * 90);
        this.inMemoryProgress.set(item.id, { progress: baseProgress, speedKbps: 0 });

        const chunkInfo = await FileSystem.getInfoAsync(chunkPath);
        const chunkSize = (chunkInfo as any).size ?? 0;

        const caption =
          `📦 ${item.fileName} [Part ${partNumber} of ${totalParts}]\n` +
          `📊 Total: ${formatFileSize(actualSize)} | This part: ${formatFileSize(chunkSize)}\n` +
          `─────────────────────\n` +
          `💡 To restore:\n` +
          `• Nimo Save: 1-tap auto-reassemble in Cloud Explorer\n` +
          `• Android: ZArchiver or 7-Zip → open Part 1\n` +
          `• Windows: Right-click Part 1 → 7-Zip → Extract Here\n` +
          `• Terminal: cat ${item.fileName}.part* > ${item.fileName}`;

        console.log(`[UploadManager] Uploading chunk ${partNumber}/${totalParts}: ${chunkPath}`);

        const onChunkProgress = (progress: number) => {
          const chunkProgress = baseProgress + Math.round((progress / totalParts) * 90);
          this.inMemoryProgress.set(item.id, {
            progress: Math.min(95, chunkProgress),
            speedKbps: 0,
          });
        };

        // sendFile with the chunk path and caption
        const result = await tdLibClient.sendFile(
          chunkPath,
          `${item.fileName}.part${partNumber}`,
          targetChat,
          onChunkProgress,
          caption,
        );

        manifestParts.push({
          part: partNumber,
          telegramMessageId: result?.id ?? 0,
          size: chunkSize,
        });
      }

      const durationMs = Date.now() - startTime;

      // 3. Build and save the ChunkManifest
      const manifest: ChunkManifest = {
        originalFileName: item.fileName,
        originalSize: actualSize,
        totalParts,
        parts: manifestParts,
        uploadedAt: Date.now(),
      };
      await saveChunkManifest(item.fileName, manifest);

      // 4. Record a single combined entry in the uploaded index and history
      await completeUploadAtomically({
        queueId: item.id,
        uri: item.uri,
        fileName: item.fileName,
        size: actualSize,
        // Use the first part's message ID as the representative ID
        telegramMessageId: manifestParts[0]?.telegramMessageId,
        uploadedAt: Date.now(),
        uploadDurationMs: durationMs,
        destination: destName,
        chunkManifest: manifest,
      });

      // 5. Store the manifest link on the uploaded record as well (via queue storage)
      this.inMemoryProgress.set(item.id, { progress: 100, speedKbps: 0 });
      this.inMemoryProgress.delete(item.id);
      delete this.progressTrack[item.id];

      console.log(`[UploadManager] Chunked upload complete for ${item.fileName} (${totalParts} parts) in ${(durationMs / 1000).toFixed(1)}s`);
    } finally {
      // Always clean up temp chunk files, even on error
      if (chunkPaths.length > 0) {
        await cleanupChunks(chunkPaths);
      }
    }
  }

  private async updateItemStatus(
    id: string,
    status: QueueItem['status'],
    progress?: number,
    error?: string,
    uploadStartedAt?: number,
    uploadedAt?: number,
    uploadDurationMs?: number,
    speedKbps?: number
  ): Promise<void> {
    // Fix 1.6: Skip AsyncStorage writes for pure progress updates during upload;
    // only persist on real state transitions (uploading start, completed, failed).
    const isProgressOnlyUpdate =
      status === 'uploading' &&
      uploadStartedAt === undefined &&
      uploadedAt === undefined &&
      uploadDurationMs === undefined &&
      error === undefined;
    if (isProgressOnlyUpdate) {
      // Update in-memory only — UI can read from inMemoryProgress if needed
      if (progress !== undefined && speedKbps !== undefined) {
        this.inMemoryProgress.set(id, { progress, speedKbps: Math.round(speedKbps) });
      }
      return;
    }
    const queue = await getQueue();
    const index = queue.findIndex((item: QueueItem) => item.id === id);
    if (index >= 0) {
      queue[index].status = status;
      if (progress !== undefined) queue[index].progress = progress;
      if (error) queue[index].error = error;
      if (uploadStartedAt) queue[index].uploadStartedAt = uploadStartedAt;
      if (uploadedAt) queue[index].uploadedAt = uploadedAt;
      if (uploadDurationMs !== undefined) queue[index].uploadDurationMs = uploadDurationMs;
      if (speedKbps !== undefined) (queue[index] as any).speedKbps = Math.round(speedKbps);
      queue[index].lastAttemptAt = Date.now();
      if (status === 'uploading' || status === 'failed') {
        queue[index].retries = (queue[index].retries || 0) + (status === 'failed' ? 1 : 0);
      }
      await saveQueue(queue);
    }
  }
  
  async clearCompleted(): Promise<void> {
    const queue = await getQueue();
    const filtered = queue.filter((item: QueueItem) => item.status !== 'completed');
    await saveQueue(filtered);
  }

  async discardItem(id: string): Promise<void> {
    const config = await getConfig();
    const destName =
      config.targetChatTitle ||
      (config.targetChatId === 'me' ? 'Saved Messages' : String(config.targetChatId));
    await removeFromQueue(id, true, destName);
  }

  async discardAll(): Promise<void> {
    const config = await getConfig();
    const destName =
      config.targetChatTitle ||
      (config.targetChatId === 'me' ? 'Saved Messages' : String(config.targetChatId));
    try {
      if (this.queue && typeof this.queue.clear === 'function') {
        this.queue.clear();
      }
    } catch {}
    this.isRunning = false;
    await clearAllQueue(true, destName);
  }

  async clearAllQueueFromManager(recordAsDismissed: boolean = false): Promise<void> {
    try {
      // Clear pending jobs in p-queue
      if (this.queue && typeof this.queue.clear === 'function') {
        this.queue.clear();
      }
    } catch {}
    const config = await getConfig();
    const destName =
      config.targetChatTitle ||
      (config.targetChatId === 'me' ? 'Saved Messages' : String(config.targetChatId));
    await clearAllQueue(recordAsDismissed, destName);
    this.isRunning = false;
  }
}

export const uploadManager = new UploadManager();
