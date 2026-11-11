import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WatchedFolder {
  id: string;
  title: string;
  type: 'album' | 'saf';
  assetCount?: number;
}

export type ScheduleMode = 'interval' | 'window' | 'continuous';

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
  // Modern scheduler configurations
  scheduleMode?: ScheduleMode;
  intervalMinutes?: number; // Minimum 1m support (1, 5, 15, 30, 60, etc.)
  onlyWhenCharging?: boolean;
  batteryGuard?: boolean;
  batteryGuardThreshold?: number; // e.g. 20 (percent)
  minFileSizeKb?: number; // e.g. 50 (skip files < 50 KB), 0 = no min
  maxFileSizeBytes?: number; // e.g. 2147483648 (2 GB), 0 = no max
  excludedExtensions?: string[]; // e.g. ['tmp', 'log', 'nomedia', 'thumb']
  notifyOnComplete?: boolean;
  biometricLockEnabled?: boolean;
  biometricLockTimeout?: number; // in seconds: 0 (immediate), 60 (1m), 300 (5m)
}

export interface SchedulerState {
  lastRunAt?: number;
  lastRunStatus?: 'idle' | 'running' | 'success' | 'skipped' | 'partial' | 'failed';
  lastRunSummary?: string;
  lastSkipReason?: string;
  nextEstimatedRunAt?: number;
  totalAutoUploadedCount?: number;
  totalAutoUploadedBytes?: number;
}

const CONFIG_KEY = '@nimo/config';
const QUEUE_KEY = '@nimo/queue';
const UPLOADED_KEY = '@nimo/uploaded';
const LAST_SCAN_KEY = '@nimo/last_scan';
const ACTION_HISTORY_KEY = '@nimo/action_history';
const SCHEDULER_STATE_KEY = '@nimo/scheduler_state';

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
  scheduleMode: 'interval',
  intervalMinutes: 1, // Minimum 1m interval default
  onlyWhenCharging: false,
  batteryGuard: true,
  batteryGuardThreshold: 20,
  minFileSizeKb: 0,
  maxFileSizeBytes: 0,
  excludedExtensions: ['nomedia', 'tmp', 'log', 'thumb', 'bak'],
  notifyOnComplete: false,
  biometricLockEnabled: false,
  biometricLockTimeout: 0,
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
  // Fix 2.1: Deduplicate by URI — skip if already in queue with a non-completed status
  const existing = queue.find(q => q.uri === item.uri && q.status !== 'completed');
  if (existing) return existing;
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

/**
 * Batch add multiple items to the queue in a single AsyncStorage read+write.
 * Use instead of calling addToQueue() in a loop for 10+ files.
 * Returns { added: QueueItem[], skipped: number } where skipped = duplicates.
 */
export async function addManyToQueue(
  items: Omit<QueueItem, 'id' | 'status' | 'progress' | 'retries' | 'addedAt'>[]
): Promise<{ added: QueueItem[]; skipped: number }> {
  if (items.length === 0) return { added: [], skipped: 0 };

  const queue = await getQueue();
  // Build a Set of URIs already in queue (non-completed) for O(1) dedup lookup
  const existingUris = new Set(
    queue.filter(q => q.status !== 'completed').map(q => q.uri)
  );

  const now = Date.now();
  const newItems: QueueItem[] = [];
  let skipped = 0;

  for (const item of items) {
    if (existingUris.has(item.uri)) {
      skipped++;
      continue;
    }
    const newItem: QueueItem = {
      ...item,
      id: `${now}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      progress: 0,
      retries: 0,
      addedAt: now,
    };
    newItems.push(newItem);
    existingUris.add(item.uri); // prevent intra-batch duplicates
  }

  if (newItems.length > 0) {
    await saveQueue([...queue, ...newItems]);
  }

  return { added: newItems, skipped };
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


/**
 * Atomically records a completed upload across all three stores in parallel.
 * For 100+ concurrent uploads this reduces 5 sequential read+write pairs
 * down to 3 parallel reads then 3 parallel writes.
 */
export async function completeUploadAtomically(params: {
  queueId: string;
  uri: string;
  fileName: string;
  size: number;
  telegramMessageId?: number;
  uploadedAt: number;
  uploadDurationMs: number;
  destination: string;
}): Promise<void> {
  const [queue, uploadedIndex, history] = await Promise.all([
    getQueue(),
    getUploadedIndex(),
    getActionHistory(),
  ]);

  const queueIndex = queue.findIndex((item: QueueItem) => item.id === params.queueId);
  if (queueIndex >= 0) {
    queue[queueIndex].status = 'completed';
    queue[queueIndex].progress = 100;
    queue[queueIndex].uploadedAt = params.uploadedAt;
    queue[queueIndex].uploadDurationMs = params.uploadDurationMs;
    queue[queueIndex].lastAttemptAt = Date.now();
  }

  const filteredUploaded = uploadedIndex.filter((r: UploadedRecord) => r.uri !== params.uri);
  filteredUploaded.push({
    uri: params.uri,
    fileName: params.fileName,
    size: params.size,
    uploadedAt: params.uploadedAt,
    telegramMessageId: params.telegramMessageId,
  });

  const newHistoryItem: ActionHistoryItem = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    fileName: params.fileName,
    uri: params.uri,
    size: params.size,
    status: 'uploaded',
    timestamp: Date.now(),
    uploadDurationMs: params.uploadDurationMs,
    destination: params.destination,
  };
  const updatedHistory = [newHistoryItem, ...history].slice(0, MAX_HISTORY_ITEMS);

  await Promise.all([
    saveQueue(queue),
    AsyncStorage.setItem(UPLOADED_KEY, JSON.stringify(filteredUploaded)),
    AsyncStorage.setItem(ACTION_HISTORY_KEY, JSON.stringify(updatedHistory)),
  ]);
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
  status: 'uploaded' | 'failed' | 'dismissed' | 'cleaned_locally';
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
  if (!ms || ms <= 0) return '0.0s';
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec < 1 ? sec.toFixed(2) : sec.toFixed(1)}s`;
  }
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


export async function getSchedulerState(): Promise<SchedulerState> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULER_STATE_KEY);
    if (!raw) return { lastRunStatus: 'idle' };
    return JSON.parse(raw);
  } catch {
    return { lastRunStatus: 'idle' };
  }
}

export async function saveSchedulerState(patch: Partial<SchedulerState>): Promise<SchedulerState> {
  const current = await getSchedulerState();
  const updated: SchedulerState = { ...current, ...patch };
  await AsyncStorage.setItem(SCHEDULER_STATE_KEY, JSON.stringify(updated));
  return updated;
}

export async function resetSchedulerState(): Promise<void> {
  await AsyncStorage.removeItem(SCHEDULER_STATE_KEY);
}
