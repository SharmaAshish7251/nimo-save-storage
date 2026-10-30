import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { scanForNewFiles } from '../lib/scanner/files';
import { addToQueue, getConfig } from '../lib/storage/queue';
import { uploadManager } from '../lib/upload/manager';
import { isLoggedIn } from '../lib/telegram/client';

const BACKGROUND_UPLOAD_TASK = 'BACKGROUND_UPLOAD_TASK';

TaskManager.defineTask(BACKGROUND_UPLOAD_TASK, async () => {
  try {
    console.log('Background upload task started');
    
    const loggedIn = await isLoggedIn();
    if (!loggedIn) {
      console.log('Not logged in, skipping upload');
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    
    const config = await getConfig();
    if (!config.autoUploadEnabled) {
      console.log('Auto upload disabled');
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    
    // Check time window
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const { timeWindowStart, timeWindowEnd } = config;
    
    // Simple time window check (doesn't handle crossing midnight well, but basic)
    if (currentTime < timeWindowStart || currentTime > timeWindowEnd) {
      console.log(`Outside time window ${timeWindowStart}-${timeWindowEnd}, current: ${currentTime}`);
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    
    // Scan for new files
    const newFiles = await scanForNewFiles();
    console.log(`Found ${newFiles.length} new files to upload`);
    
    // Add to queue
    for (const file of newFiles) {
      await addToQueue({
        uri: file.uri,
        fileName: file.fileName,
        size: file.size,
        mimeType: file.mimeType,
      });
    }
    
    // Process queue
    await uploadManager.processQueue();
    
    console.log('Background upload task completed');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('Background upload task failed:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundUploadTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_UPLOAD_TASK);
    if (isRegistered) {
      console.log('Task already registered');
      return;
    }
    
    await BackgroundTask.registerTaskAsync(BACKGROUND_UPLOAD_TASK);
    console.log('Background upload task registered');
  } catch (error) {
    console.error('Failed to register background task:', error);
  }
}

export async function unregisterBackgroundUploadTask(): Promise<void> {
  try {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_UPLOAD_TASK);
    console.log('Background upload task unregistered');
  } catch (error) {
    console.error('Failed to unregister background task:', error);
  }
}

export async function isBackgroundTaskRegistered(): Promise<boolean> {
  return await TaskManager.isTaskRegisteredAsync(BACKGROUND_UPLOAD_TASK);
}
