import PQueue from 'p-queue';
import {
  getQueue,
  saveQueue,
  QueueItem,
  markUploaded,
  getConfig,
  recordActionHistory,
  removeFromQueue,
  clearAllQueue,
} from '../storage/queue';
import { sendFile } from '../telegram/client';
import { getFileInfo } from '../storage/fileHelper';
import NetInfo from '@react-native-community/netinfo';

export class UploadManager {
  private queue: any;
  private isRunning = false;
  
  constructor(concurrency: number = 3) {
    this.queue = new PQueue({ concurrency });
  }
  
  async setConcurrency(concurrency: number) {
    this.queue.concurrency = concurrency;
  }
  
  async checkNetworkConditions(): Promise<boolean> {
    const config = await getConfig();
    const netInfo = await NetInfo.fetch();
    
    if (!(netInfo as any).isConnected) return false;
    if (config.wifiOnly && (netInfo as any).type !== 'wifi') return false;
    
    return true;
  }
  
  async processQueue(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    
    try {
      const canUpload = await this.checkNetworkConditions();
      if (!canUpload) {
        console.log('Network conditions not met for upload');
        return;
      }
      
      const queueItems = await getQueue();
      const pendingItems = queueItems.filter((item: QueueItem) => item.status === 'pending');
      
      const config = await getConfig();
      this.setConcurrency(config.concurrency);
      
      for (const item of pendingItems) {
        this.queue.add(() => this.uploadItem(item));
      }
      
      await this.queue.onIdle();
    } finally {
      this.isRunning = false;
    }
  }
  
  private async uploadItem(item: QueueItem): Promise<void> {
    const startTime = Date.now();
    try {
      await this.updateItemStatus(item.id, 'uploading', 0, undefined, startTime);
      
      const fileInfo = await getFileInfo(item.uri);
      if (!fileInfo.exists && !item.uri.startsWith('content://')) {
        throw new Error('File does not exist');
      }
      
      const config = await getConfig();
      const targetChat = config.uploadToSavedMessages || !config.targetChatId ? 'me' : config.targetChatId;
      
      const result = await sendFile(
        item.uri,
        item.fileName,
        targetChat,
        (progress: number) => {
          this.updateItemStatus(item.id, 'uploading', Math.round(progress * 100));
        }
      );
      
      const durationMs = Date.now() - startTime;

      await markUploaded({
        uri: item.uri,
        fileName: item.fileName,
        size: item.size,
        uploadedAt: Date.now(),
        telegramMessageId: result?.id,
      });

      const destName =
        config.targetChatTitle ||
        (targetChat === 'me' ? 'Saved Messages' : String(targetChat));

      await recordActionHistory({
        fileName: item.fileName,
        uri: item.uri,
        size: item.size,
        status: 'uploaded',
        destination: destName,
        uploadDurationMs: durationMs,
      });
      
      await this.updateItemStatus(item.id, 'completed', 100, undefined, undefined, Date.now(), durationMs);
      
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
    }
  }
  
  private async updateItemStatus(
    id: string,
    status: QueueItem['status'],
    progress?: number,
    error?: string,
    uploadStartedAt?: number,
    uploadedAt?: number,
    uploadDurationMs?: number
  ): Promise<void> {
    const queue = await getQueue();
    const index = queue.findIndex((item: QueueItem) => item.id === id);
    if (index >= 0) {
      queue[index].status = status;
      if (progress !== undefined) queue[index].progress = progress;
      if (error) queue[index].error = error;
      if (uploadStartedAt) queue[index].uploadStartedAt = uploadStartedAt;
      if (uploadedAt) queue[index].uploadedAt = uploadedAt;
      if (uploadDurationMs !== undefined) queue[index].uploadDurationMs = uploadDurationMs;
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
    await clearAllQueue(true, destName);
  }
}

export const uploadManager = new UploadManager();

