import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WatchedFolder {
  id: string;
  title: string;
  type: 'album' | 'saf';
  assetCount?: number;
}

export interface AppConfig {
  watchFolders: string[]; // folder paths/URIs
  watchedFolders?: WatchedFolder[];
  wifiOnly: boolean;
  timeWindowStart: string; // HH:mm
  timeWindowEnd: string; // HH:mm
  concurrency: number; // number of concurrent uploads
  autoUploadEnabled: boolean;
  uploadToSavedMessages: boolean;
  targetChatId?: string;
  targetChatTitle?: string;
  targetChatType?: 'saved' | 'channel' | 'group' | 'chat';
}

const CONFIG_KEY = '@nimo/config';
const QUEUE_KEY = '@nimo/queue';
const UPLOADED_KEY = '@nimo/uploaded';
const LAST_SCAN_KEY = '@nimo/last_scan';
const ACTION_HISTORY_KEY = '@nimo/action_history';

const DEFAULT_CONFIG: AppConfig = {
  watchFolders: [],
  wifiOnly: false,
  timeWindowStart: '00:00',
  timeWindowEnd: '06:00',
  concurrency: 3,
  autoUploadEnabled: false,
  uploadToSavedMessages: true,
  targetChatId: 'me',
  targetChatTitle: 'Saved Messages',
  targetChatType: 'saved',
};

export async function getConfig(): Promise<AppConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const current = await getConfig();
  const updated = { ...current, ...config };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

export async function getWatchedFolders(): Promise<WatchedFolder[]> {
  const config = await getConfig();
  return config.watchedFolders || [];
}

export async function saveWatchedFolders(folders: WatchedFolder[]): Promise<void> {
  await saveConfig({
    watchedFolders: folders,
    watchFolders: folders.map((f) => f.id),
  });
}

export interface QueueItem {
  id: string;
  uri: string;
  fileName: string;
  size: number;
  mimeType?: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'paused';
  progress: number;
  retries: number;
  addedAt: number;
  lastAttemptAt?: number;
  uploadStartedAt?: number;
  uploadedAt?: number;
  uploadDurationMs?: number;
  error?: string;
  speedKbps?: number;
}

export async function getQueue(): Promise<QueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveQueue(queue: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function addToQueue(item: Omit<QueueItem, 'id' | 'status' | 'progress' | 'retries' | 'addedAt'>): Promise<QueueItem> {
  const queue = await getQueue();
  const newItem: QueueItem = {
    ...item,
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending',
    progress: 0,
    retries: 0,
    addedAt: Date.now(),
  };
  queue.push(newItem);
  await saveQueue(queue);
  return newItem;
}

export async function resetItemToPending(id: string): Promise<QueueItem | null> {
  const queue = await getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index >= 0) {
    queue[index].status = 'pending';
    queue[index].progress = 0;
    delete queue[index].error;
    queue[index].lastAttemptAt = undefined;
    await saveQueue(queue);
    return queue[index];
  }
  return null;
}

export interface UploadedRecord {
  uri: string;
  fileName: string;
  size: number;
  hash?: string;
  uploadedAt: number;
  telegramMessageId?: number;
}

export async function getUploadedIndex(): Promise<UploadedRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(UPLOADED_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function markUploaded(record: UploadedRecord): Promise<void> {
  const index = await getUploadedIndex();
  // Avoid duplicates by uri
  const filtered = index.filter(r => r.uri !== record.uri);
  filtered.push(record);
  await AsyncStorage.setItem(UPLOADED_KEY, JSON.stringify(filtered));
}

export async function isUploaded(uri: string): Promise<boolean> {
  const index = await getUploadedIndex();
  return index.some(r => r.uri === uri);
}

export async function getLastScanTime(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SCAN_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

export async function setLastScanTime(time: number = Date.now()): Promise<void> {
  await AsyncStorage.setItem(LAST_SCAN_KEY, time.toString());
}

export interface ActionHistoryItem {
  id: string;
  fileName: string;
  uri: string;
  size: number;
  status: 'uploaded' | 'failed' | 'dismissed';
  timestamp: number;
  uploadDurationMs?: number;
  destination?: string;
  error?: string;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const remainingSec = Math.round(sec % 60);
  return `${mins}m ${remainingSec}s`;
}

export function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || isNaN(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

export async function getActionHistory(): Promise<ActionHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(ACTION_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

const MAX_HISTORY_ITEMS = 10000;

export async function recordActionHistory(
  item: Omit<ActionHistoryItem, 'id' | 'timestamp'>
): Promise<ActionHistoryItem> {
  const history = await getActionHistory();
  const newItem: ActionHistoryItem = {
    ...item,
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
  };
  // Prepend to show most recent first, keep up to 10,000 items
  const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
  await AsyncStorage.setItem(ACTION_HISTORY_KEY, JSON.stringify(updated));
  return newItem;
}

export async function clearActionHistory(): Promise<void> {
  await AsyncStorage.removeItem(ACTION_HISTORY_KEY);
}

export async function removeFromQueue(
  itemId: string,
  recordAsDismissed: boolean = true,
  destination?: string
): Promise<void> {
  const queue = await getQueue();
  const target = queue.find((i) => i.id === itemId);
  const updated = queue.filter((i) => i.id !== itemId);
  await saveQueue(updated);

  if (target && recordAsDismissed) {
    await recordActionHistory({
      fileName: target.fileName,
      uri: target.uri,
      size: target.size,
      status: 'dismissed',
      destination,
    });
  }
}

export async function clearAllQueue(
  recordAsDismissed: boolean = false,
  destination?: string
): Promise<void> {
  const queue = await getQueue();
  if (recordAsDismissed) {
    for (const item of queue) {
      await recordActionHistory({
        fileName: item.fileName,
        uri: item.uri,
        size: item.size,
        status: 'dismissed',
        destination,
      });
    }
  }
  await saveQueue([]);
}
