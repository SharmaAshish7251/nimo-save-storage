import PQueue from 'p-queue';
import * as FileSystem from 'expo-file-system/legacy';
import { getQueue, saveQueue, QueueItem, markUploaded, getConfig } from '../storage/queue';
import { sendFile } from '../telegram/client';
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
    try {
      await this.updateItemStatus(item.id, 'uploading');
      
      const fileInfo: any = await FileSystem.getInfoAsync(item.uri);
      if (!fileInfo.exists) {
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
      
      await markUploaded({
        uri: item.uri,
        fileName: item.fileName,
        size: item.size,
        uploadedAt: Date.now(),
        telegramMessageId: result?.id,
      });
      
      await this.updateItemStatus(item.id, 'completed', 100);
      
      console.log(`Uploaded ${item.fileName} successfully`);
    } catch (error: any) {
      console.error(`Failed to upload ${item.fileName}:`, error);
      await this.updateItemStatus(item.id, 'failed', item.progress, error.message);
    }
  }
  
  private async updateItemStatus(
    id: string,
    status: QueueItem['status'],
    progress?: number,
    error?: string
  ): Promise<void> {
    const queue = await getQueue();
    const index = queue.findIndex((item: QueueItem) => item.id === id);
    if (index >= 0) {
      queue[index].status = status;
      if (progress !== undefined) queue[index].progress = progress;
      if (error) queue[index].error = error;
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
}

export const uploadManager = new UploadManager();

