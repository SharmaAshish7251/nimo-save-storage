import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { formatFileSize } from '../storage/queue';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.DEFAULT,
  }),
});

const PROGRESS_CHANNEL_ID = 'upload-progress';
const ALERT_CHANNEL_ID = 'upload-alerts';

export class UploadNotificationService {
  private progressNotificationId: string | null = null;
  private isInitialized = false;
  private lastUpdateTimestamp = 0;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync(PROGRESS_CHANNEL_ID, {
          name: 'Upload Progress',
          importance: Notifications.AndroidImportance.LOW,
          vibrationPattern: null,
          enableVibrate: false,
          sound: null,
          showBadge: false,
        });

        await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
          name: 'Backup Alerts',
          importance: Notifications.AndroidImportance.DEFAULT,
          sound: 'default',
          showBadge: true,
        });
      } catch (err) {
        console.warn('[UploadNotification] Failed to setup channels:', err);
      }
    }

    this.isInitialized = true;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      return finalStatus === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Updates or creates a sticky progress notification in the Android shade.
   * Throttled to max 2 updates per second to avoid NotificationManager rate limits.
   */
  async showUploadProgress(
    current: number,
    total: number,
    percent: number,
    speedKbps: number = 0,
    etaSeconds: number = 0
  ): Promise<void> {
    const now = Date.now();
    // Allow first notification immediately, throttle subsequent progress updates
    if (this.progressNotificationId && now - this.lastUpdateTimestamp < 500) {
      return;
    }
    this.lastUpdateTimestamp = now;

    await this.init();

    const speedStr = speedKbps > 1024 
      ? `${(speedKbps / 1024).toFixed(1)} MB/s` 
      : `${Math.round(speedKbps)} KB/s`;

    let etaStr = '';
    if (etaSeconds > 0 && etaSeconds < 3600) {
      etaStr = etaSeconds < 60 ? ` • ~${etaSeconds}s remaining` : ` • ~${Math.ceil(etaSeconds / 60)}m remaining`;
    }

    const title = `Backing up to Telegram (${Math.min(100, Math.max(0, percent))}%)`;
    const body = total > 0 
      ? `Uploading ${Math.min(current, total)} of ${total} • ${speedStr}${etaStr}`
      : `Uploading files • ${speedStr}`;

    try {
      // Dismiss prior notification if ID exists
      if (this.progressNotificationId) {
        await Notifications.dismissNotificationAsync(this.progressNotificationId).catch(() => {});
      }

      this.progressNotificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          priority: Notifications.AndroidNotificationPriority.LOW,
          sticky: true,
          autoDismiss: false,
          data: { type: 'upload_progress' },
        },
        trigger: {
          channelId: PROGRESS_CHANNEL_ID,
        },
      });
    } catch (e) {
      console.warn('[UploadNotification] Failed to present progress notification:', e);
    }
  }

  /**
   * Dismisses the progress notification.
   */
  async dismissProgress(): Promise<void> {
    if (this.progressNotificationId) {
      const id = this.progressNotificationId;
      this.progressNotificationId = null;
      try {
        await Notifications.dismissNotificationAsync(id);
      } catch {}
    }
  }

  /**
   * Shows a completion notification when batch upload finishes.
   */
  async showUploadComplete(uploadedCount: number, totalBytes: number = 0): Promise<void> {
    await this.dismissProgress();
    if (uploadedCount <= 0) return;

    await this.init();
    const sizeStr = totalBytes > 0 ? ` (${formatFileSize(totalBytes)})` : '';

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Backup Complete ✓',
          body: `Successfully backed up ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}${sizeStr} to Telegram.`,
          sound: true,
          data: { type: 'upload_complete' },
        },
        trigger: {
          channelId: ALERT_CHANNEL_ID,
        },
      });
    } catch (e) {
      console.warn('[UploadNotification] Failed to schedule completion notification:', e);
    }
  }

  /**
   * Shows a non-fatal failure alert notification.
   */
  async showUploadError(fileName: string, errorMessage: string): Promise<void> {
    await this.init();
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Upload Failed',
          body: `${fileName}: ${errorMessage}`,
          sound: true,
          data: { type: 'upload_error' },
        },
        trigger: {
          channelId: ALERT_CHANNEL_ID,
        },
      });
    } catch {}
  }
}

export const uploadNotificationService = new UploadNotificationService();
