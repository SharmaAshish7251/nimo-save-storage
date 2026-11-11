import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { tdLibClient } from '../tdlib/client';
import { uploadManager } from '../upload/manager';
import { scanForNewFiles } from '../scanner/files';
import {
  getConfig,
  getSchedulerState,
  saveSchedulerState,
  addManyToQueue,
  AppConfig,
  SchedulerState,
} from '../storage/queue';

export interface ConditionCheckResult {
  canRun: boolean;
  reason?: string;
  code:
    | 'OK'
    | 'NOT_LOGGED_IN'
    | 'DISABLED'
    | 'WIFI_REQUIRED'
    | 'NO_INTERNET'
    | 'OUTSIDE_WINDOW'
    | 'INTERVAL_NOT_ELAPSED'
    | 'ALREADY_RUNNING'
    | 'METERED_NETWORK';
}

export interface SchedulerRunResult {
  status: 'success' | 'skipped' | 'partial' | 'failed';
  reason?: string;
  triggerSource: 'os_background' | 'interval_timer' | 'app_foreground' | 'manual';
  scannedFiles: number;
  queuedFiles: number;
  uploadedCount: number;
  failedCount: number;
  durationMs: number;
  error?: string;
}

/**
 * Checks if current time is within a start-end time window (supports midnight-spanning windows).
 */
export function isWithinTimeWindow(currentTime: string, start: string, end: string): boolean {
  if (start <= end) {
    return currentTime >= start && currentTime <= end;
  }
  // Midnight-spanning, e.g. 22:00 to 06:00
  return currentTime >= start || currentTime <= end;
}

/**
 * Calculates human-readable next estimated run time and ISO date.
 */
export function calculateNextEstimatedRun(
  config: AppConfig,
  lastRunAt: number = Date.now()
): { nextRunDate: Date; humanText: string } {
  const mode = config.scheduleMode || 'interval';
  const now = new Date();

  if (mode === 'interval') {
    const intervalMinutes = Math.max(1, config.intervalMinutes ?? 1);
    const nextDate = new Date(lastRunAt + intervalMinutes * 60 * 1000);
    const diffMs = nextDate.getTime() - Date.now();
    if (diffMs <= 0) {
      return { nextRunDate: now, humanText: 'Due now' };
    }
    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins === 1) return { nextRunDate: nextDate, humanText: 'in ~1 minute' };
    if (diffMins < 60) return { nextRunDate: nextDate, humanText: `in ~${diffMins} minutes` };
    const diffHours = (diffMins / 60).toFixed(1);
    return { nextRunDate: nextDate, humanText: `in ~${diffHours} hours` };
  }

  if (mode === 'window') {
    const startStr = config.timeWindowStart || '00:00';
    const [startH, startM] = startStr.split(':').map(Number);
    const target = new Date(now);
    target.setHours(startH, startM, 0, 0);

    // If window start has already passed today and end is also passed, schedule for tomorrow
    const currentStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const inside = isWithinTimeWindow(currentStr, config.timeWindowStart, config.timeWindowEnd);
    if (inside) {
      return { nextRunDate: now, humanText: 'Active window (Now)' };
    }
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    const diffMs = target.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / 3600000);
    return {
      nextRunDate: target,
      humanText: `at ${startStr} (~${diffHours}h from now)`,
    };
  }

  // Continuous
  return { nextRunDate: now, humanText: 'Continuous (Active)' };
}

/**
 * Safely triggers an optional local notification on completion.
 */
async function sendNotification(title: string, body: string): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'denied' }));
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: null,
    });
  } catch (e) {
    console.log('Notification trigger skipped/failed (non-fatal):', e);
  }
}

class SchedulerEngine {
  private isRunning: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: any = null;
  private listeners: Set<(state: SchedulerState) => void> = new Set();

  /**
   * Pre-flight evaluation of all preconditions before triggering a backup run.
   */
  async checkConditions(
    config: AppConfig,
    options: { forceManual?: boolean } = {}
  ): Promise<ConditionCheckResult> {
    if (uploadManager.isActive) {
      return { canRun: false, reason: 'Upload already in progress', code: 'ALREADY_RUNNING' };
    }

    const loggedIn = await tdLibClient.isLoggedIn().catch(() => false);
    if (!loggedIn) {
      return { canRun: false, reason: 'Telegram not connected', code: 'NOT_LOGGED_IN' };
    }

    if (!options.forceManual && !config.autoUploadEnabled) {
      return { canRun: false, reason: 'Auto upload disabled', code: 'DISABLED' };
    }

    const netInfo = await NetInfo.fetch();
    if (!netInfo.isConnected) {
      return { canRun: false, reason: 'No internet connection', code: 'NO_INTERNET' };
    }

    if (!options.forceManual && config.wifiOnly && netInfo.type !== 'wifi') {
      return { canRun: false, reason: 'WiFi required (currently on cellular/other)', code: 'WIFI_REQUIRED' };
    }

    // Schedule-specific constraints (bypass if user manually tapped "Run Now")
    if (!options.forceManual) {
      const mode = config.scheduleMode || 'interval';

      if (mode === 'window') {
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const { timeWindowStart, timeWindowEnd } = config;
        if (!isWithinTimeWindow(currentTime, timeWindowStart, timeWindowEnd)) {
          return {
            canRun: false,
            reason: `Outside scheduled window (${timeWindowStart}–${timeWindowEnd})`,
            code: 'OUTSIDE_WINDOW',
          };
        }
      } else if (mode === 'interval') {
        const state = await getSchedulerState();
        const intervalMinutes = Math.max(1, config.intervalMinutes ?? 1);
        const intervalMs = intervalMinutes * 60 * 1000;
        const lastRun = state.lastRunAt || 0;
        const timeSinceLastRun = Date.now() - lastRun;

        if (lastRun > 0 && timeSinceLastRun < intervalMs) {
          const remainingSecs = Math.ceil((intervalMs - timeSinceLastRun) / 1000);
          return {
            canRun: false,
            reason: `Interval not reached (${remainingSecs}s remaining)`,
            code: 'INTERVAL_NOT_ELAPSED',
          };
        }
      }
    }

    return { canRun: true, code: 'OK' };
  }

  /**
   * Main scheduler execution workflow.
   */
  async executeScheduler(options: {
    forceManual?: boolean;
    triggerSource?: 'os_background' | 'interval_timer' | 'app_foreground' | 'manual';
  } = {}): Promise<SchedulerRunResult> {
    const triggerSource = options.triggerSource || 'manual';
    const startTime = Date.now();

    if (this.isRunning) {
      return {
        status: 'skipped',
        reason: 'Scheduler execution already in progress',
        triggerSource,
        scannedFiles: 0,
        queuedFiles: 0,
        uploadedCount: 0,
        failedCount: 0,
        durationMs: 0,
      };
    }

    this.isRunning = true;
    const config = await getConfig();

    try {
      // 1. Evaluate conditions
      const condition = await this.checkConditions(config, { forceManual: options.forceManual });
      if (!condition.canRun) {
        console.log(`[Scheduler] Run skipped: ${condition.reason} (${condition.code})`);
        const currentState = await getSchedulerState();
        const nextInfo = calculateNextEstimatedRun(config, currentState.lastRunAt || Date.now());
        const updatedState = await saveSchedulerState({
          lastRunStatus: 'skipped',
          lastSkipReason: condition.reason,
          nextEstimatedRunAt: nextInfo.nextRunDate.getTime(),
        });
        this.notifyListeners(updatedState);

        return {
          status: 'skipped',
          reason: condition.reason,
          triggerSource,
          scannedFiles: 0,
          queuedFiles: 0,
          uploadedCount: 0,
          failedCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // 2. Mark state as running
      await saveSchedulerState({
        lastRunStatus: 'running',
        lastSkipReason: undefined,
      });

      console.log(`[Scheduler] Scanning files (Trigger: ${triggerSource})...`);
      // 3. Scan for new files
      const newFiles = await scanForNewFiles();
      let queuedCount = 0;

      if (newFiles.length > 0) {
        console.log(`[Scheduler] Found ${newFiles.length} new files, adding to queue...`);
        const queuedResult = await addManyToQueue(
          newFiles.map((file) => ({
            uri: file.uri,
            fileName: file.fileName,
            size: file.size,
            mimeType: file.mimeType,
          }))
        );
        queuedCount = queuedResult.added.length;
      }

      // 4. Process queue
      let uploadedCount = 0;
      let failedCount = 0;
      let errorSummary: string | undefined;

      try {
        const processResult = await uploadManager.processQueue({
          forceManual: options.forceManual,
        });
        uploadedCount = processResult.uploaded;
        failedCount = processResult.failed;
        if (processResult.errors && processResult.errors.length > 0) {
          errorSummary = processResult.errors.join('; ');
        }
      } catch (err: any) {
        const msg = err?.message || '';
        // Fix 2.4: Expected queue states are non-fatal skips
        if (
          msg.includes('EMPTY_QUEUE') ||
          msg.includes('WIFI_ONLY') ||
          msg.includes('NO_INTERNET') ||
          msg.includes('ALL_FAILED')
        ) {
          console.log(`[Scheduler] Queue processing note: ${msg.split(':')[0]}`);
        } else {
          console.error('[Scheduler] Queue processing error:', err);
          errorSummary = msg;
        }
      }

      const durationMs = Date.now() - startTime;
      const finalStatus =
        failedCount > 0 && uploadedCount === 0
          ? 'failed'
          : failedCount > 0
          ? 'partial'
          : 'success';

      const summary =
        uploadedCount > 0
          ? `Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}${failedCount > 0 ? `, ${failedCount} failed` : ''}`
          : queuedCount > 0
          ? `Queued ${queuedCount} files`
          : 'No new files to backup';

      const nextInfo = calculateNextEstimatedRun(config, Date.now());

      const currentState = await getSchedulerState();
      const updatedState = await saveSchedulerState({
        lastRunAt: Date.now(),
        lastRunStatus: finalStatus,
        lastRunSummary: summary,
        lastSkipReason: undefined,
        nextEstimatedRunAt: nextInfo.nextRunDate.getTime(),
        totalAutoUploadedCount: (currentState.totalAutoUploadedCount || 0) + uploadedCount,
      });

      this.notifyListeners(updatedState);

      // 5. Send notification if configured
      if (config.notifyOnComplete && uploadedCount > 0) {
        await sendNotification(
          'Backup Completed',
          `Successfully backed up ${uploadedCount} file${uploadedCount === 1 ? '' : 's'} to Telegram.`
        );
      }

      return {
        status: finalStatus,
        triggerSource,
        scannedFiles: newFiles.length,
        queuedFiles: queuedCount,
        uploadedCount,
        failedCount,
        durationMs,
        error: errorSummary,
      };
    } catch (error: any) {
      console.error('[Scheduler] Fatal execution failure:', error);
      const nextInfo = calculateNextEstimatedRun(config, Date.now());
      const updatedState = await saveSchedulerState({
        lastRunAt: Date.now(),
        lastRunStatus: 'failed',
        lastRunSummary: `Error: ${error?.message || 'Unknown failure'}`,
        nextEstimatedRunAt: nextInfo.nextRunDate.getTime(),
      });
      this.notifyListeners(updatedState);

      return {
        status: 'failed',
        triggerSource,
        scannedFiles: 0,
        queuedFiles: 0,
        uploadedCount: 0,
        failedCount: 0,
        durationMs: Date.now() - startTime,
        error: error?.message || 'Scheduler failed',
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Initializes the in-app active ticker and lifecycle listeners.
   * Runs whenever the app is loaded.
   */
  startActiveRunner(): void {
    if (this.timer) return;

    console.log('[Scheduler] Starting in-app active runner loop (tick: 15s)...');

    // Tick every 15s to evaluate 1m+ intervals accurately without battery drain
    this.timer = setInterval(async () => {
      try {
        if (this.isRunning || uploadManager.isActive) return;
        const config = await getConfig();
        if (!config.autoUploadEnabled) return;

        const condition = await this.checkConditions(config);
        if (condition.canRun) {
          console.log('[Scheduler] Interval condition satisfied, auto-triggering...');
          await this.executeScheduler({ triggerSource: 'interval_timer' });
        }
      } catch (err) {
        console.warn('[Scheduler] Interval runner tick error:', err);
      }
    }, 15000);

    // Opportunistic check on app foreground resumption
    this.appStateSubscription = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        try {
          if (this.isRunning || uploadManager.isActive) return;
          const config = await getConfig();
          if (!config.autoUploadEnabled) return;

          const condition = await this.checkConditions(config);
          if (condition.canRun) {
            console.log('[Scheduler] App resumed to foreground, running opportunistic backup...');
            await this.executeScheduler({ triggerSource: 'app_foreground' });
          }
        } catch (err) {
          console.warn('[Scheduler] AppState trigger error:', err);
        }
      }
    });
  }

  stopActiveRunner(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.appStateSubscription?.remove) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    console.log('[Scheduler] In-app runner stopped');
  }

  subscribe(listener: (state: SchedulerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(state: SchedulerState) {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (e) {
        console.error('Scheduler listener error:', e);
      }
    }
  }
}

export const schedulerEngine = new SchedulerEngine();
