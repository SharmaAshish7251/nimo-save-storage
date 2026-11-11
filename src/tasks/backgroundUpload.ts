import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { schedulerEngine } from '../lib/scheduler/schedulerEngine';
import { getConfig } from '../lib/storage/queue';

const BACKGROUND_UPLOAD_TASK = 'BACKGROUND_UPLOAD_TASK';

try {
  if (TaskManager && typeof TaskManager.defineTask === 'function') {
    TaskManager.defineTask(BACKGROUND_UPLOAD_TASK, async () => {
      try {
        console.log('[BackgroundTask] OS background upload worker awakened');
        const result = await schedulerEngine.executeScheduler({
          triggerSource: 'os_background',
        });

        console.log(`[BackgroundTask] Finished with status: ${result.status} (uploaded: ${result.uploadedCount})`);
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch (error) {
        console.error('[BackgroundTask] Worker execution error:', error);
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });

    if (BackgroundTask && typeof BackgroundTask.addExpirationListener === 'function') {
      BackgroundTask.addExpirationListener(() => {
        console.warn('[BackgroundTask] System expiring background execution window.');
      });
    }
  }
} catch (e) {
  console.warn('Could not define background task:', e);
}

/**
 * Registers the background task with the OS.
 * Android WorkManager and iOS Background App Refresh enforce a native minimum of 15 minutes.
 * If user selects 1m in settings, the OS task runs at the minimum allowed (15m) while our
 * in-app active runner handles precision 1m intervals while active.
 */
export async function registerBackgroundUploadTask(intervalMinutes?: number): Promise<void> {
  try {
    if (!TaskManager || !BackgroundTask) return;

    const config = await getConfig();
    const interval = intervalMinutes ?? config.intervalMinutes ?? 1;
    // Native WorkManager/iOS clamp: minimum 15 mins for OS worker
    const osMinimumInterval = Math.max(15, interval);

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_UPLOAD_TASK);
    if (isRegistered) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_UPLOAD_TASK).catch(() => {});
    }

    await BackgroundTask.registerTaskAsync(BACKGROUND_UPLOAD_TASK, {
      minimumInterval: osMinimumInterval,
    });
    console.log(`[BackgroundTask] Registered with minimumInterval: ${osMinimumInterval}m (in-app: ${interval}m)`);
  } catch (error) {
    console.warn('Failed to register background task (non-fatal):', error);
  }
}

export async function unregisterBackgroundUploadTask(): Promise<void> {
  try {
    if (!BackgroundTask) return;
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_UPLOAD_TASK);
    console.log('[BackgroundTask] Unregistered');
  } catch (error) {
    console.warn('Failed to unregister background task:', error);
  }
}

export async function isBackgroundTaskRegistered(): Promise<boolean> {
  try {
    if (!TaskManager) return false;
    return await TaskManager.isTaskRegisteredAsync(BACKGROUND_UPLOAD_TASK);
  } catch {
    return false;
  }
}
