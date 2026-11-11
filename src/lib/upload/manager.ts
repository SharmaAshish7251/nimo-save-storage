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
} from '../storage/queue';
import { tdLibClient } from '../tdlib/client';
import { getFileInfo } from '../storage/fileHelper';
import NetInfo from '@react-native-community/netinfo';

export interface ProcessQueueResult {
  total: number;
  uploaded: number;
  failed: number;
  errors: string[];
}

const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB - Telegram limit

export class UploadManager {
  private queue: any;
  private isRunning = false;
  private progressTrack: Record<string, { bytes: number; time: number }> = {};
  // Fix 1.6: In-memory progress cache to avoid AsyncStorage thrashing
  private inMemoryProgress: Map<string, { progress: number; speedKbps: number }> = new Map();

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
      
      let uploadedCount = 0;
      let failedCount = 0;
      const errorMessages: string[] = [];

      for (const item of pendingItems) {
        this.queue.add(async () => {
          try {
            await this.uploadItem(item);
            uploadedCount++;
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

      return {
        total: pendingItems.length,
        uploaded: uploadedCount,
        failed: failedCount,
        errors: errorMessages,
      };
    } finally {
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

      if (actualSize && actualSize > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error(`File too large (${Math.round(actualSize / 1024 / 1024)}MB). Max ${Math.round(MAX_UPLOAD_SIZE_BYTES / 1024 / 1024)}MB (Telegram limit).`);
      }
      
      const config = await getConfig();
      const targetChat = config.uploadToSavedMessages || !config.targetChatId ? 'me' : config.targetChatId;
      
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
      };

      console.log('[UploadManager] Uploading via native TDLib MTProto engine');
      result = await tdLibClient.sendFile(item.uri, item.fileName, targetChat, onUploadProgress);

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
