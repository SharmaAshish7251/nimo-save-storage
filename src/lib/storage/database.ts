import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getFileCategory, FileCategory } from './fileHelper';
import type { ChunkManifest } from './reassembler';

export interface UploadedRecord {
  uri: string;
  fileName: string;
  size: number;
  hash?: string;
  uploadedAt: number;
  telegramMessageId?: number;
  chatId?: number;
  destinationTitle?: string;
  mediaAssetId?: string;
  chunkManifest?: ChunkManifest;
  cloudStatus?: 'synced' | 'missing' | 'local_only';
  lastVerifiedAt?: number;
  category?: FileCategory;
}

export interface QueueItem {
  id: string;
  uri: string;
  fileName: string;
  size: number;
  mimeType?: string;
  mediaAssetId?: string;
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

interface UploadedRow {
  uri: string;
  file_name: string;
  size: number;
  hash: string | null;
  uploaded_at: number;
  telegram_message_id: number | null;
  chat_id: number | null;
  destination_title: string | null;
  media_asset_id: string | null;
  chunk_manifest: string | null;
  cloud_status: string | null;
  last_verified_at: number | null;
  category: string;
}

interface QueueRow {
  id: string;
  uri: string;
  file_name: string;
  size: number;
  mime_type: string | null;
  media_asset_id: string | null;
  status: string;
  progress: number;
  retries: number;
  added_at: number;
  last_attempt_at: number | null;
  upload_started_at: number | null;
  uploaded_at: number | null;
  upload_duration_ms: number | null;
  error: string | null;
  speed_kbps: number | null;
}

interface HistoryRow {
  id: string;
  file_name: string;
  uri: string;
  size: number;
  status: string;
  timestamp: number;
  upload_duration_ms: number | null;
  destination: string | null;
  error: string | null;
}

const DB_NAME = 'nimo_storage.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function rowToUploadedRecord(row: UploadedRow): UploadedRecord {
  let chunkManifest: ChunkManifest | undefined;
  if (row.chunk_manifest) {
    try {
      chunkManifest = JSON.parse(row.chunk_manifest);
    } catch {}
  }

  return {
    uri: row.uri,
    fileName: row.file_name,
    size: row.size,
    hash: row.hash ?? undefined,
    uploadedAt: row.uploaded_at,
    telegramMessageId: row.telegram_message_id ?? undefined,
    chatId: row.chat_id ?? undefined,
    destinationTitle: row.destination_title ?? undefined,
    mediaAssetId: row.media_asset_id ?? undefined,
    chunkManifest,
    cloudStatus: (row.cloud_status as any) || 'synced',
    lastVerifiedAt: row.last_verified_at ?? undefined,
    category: row.category as FileCategory,
  };
}

function rowToQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    uri: row.uri,
    fileName: row.file_name,
    size: row.size,
    mimeType: row.mime_type ?? undefined,
    mediaAssetId: row.media_asset_id ?? undefined,
    status: row.status as QueueItem['status'],
    progress: row.progress,
    retries: row.retries,
    addedAt: row.added_at,
    lastAttemptAt: row.last_attempt_at ?? undefined,
    uploadStartedAt: row.upload_started_at ?? undefined,
    uploadedAt: row.uploaded_at ?? undefined,
    uploadDurationMs: row.upload_duration_ms ?? undefined,
    error: row.error ?? undefined,
    speedKbps: row.speed_kbps ?? undefined,
  };
}

function rowToActionHistoryItem(row: HistoryRow): ActionHistoryItem {
  return {
    id: row.id,
    fileName: row.file_name,
    uri: row.uri,
    size: row.size,
    status: row.status as ActionHistoryItem['status'],
    timestamp: row.timestamp,
    uploadDurationMs: row.upload_duration_ms ?? undefined,
    destination: row.destination ?? undefined,
    error: row.error ?? undefined,
  };
}

async function migrateFromAsyncStorage(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const metaRow = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key = ?',
      ['migration_sqlite_v1']
    );
    if (metaRow?.value === 'done') {
      return;
    }

    console.log('[SQLite] Checking for legacy AsyncStorage data to migrate...');

    // 1. Uploaded Index
    const rawUploaded = await AsyncStorage.getItem('@nimo/uploaded');
    if (rawUploaded) {
      try {
        const uploadedList: UploadedRecord[] = JSON.parse(rawUploaded);
        if (Array.isArray(uploadedList) && uploadedList.length > 0) {
          console.log(`[SQLite] Migrating ${uploadedList.length} uploaded records...`);
          await db.withTransactionAsync(async () => {
            for (const r of uploadedList) {
              const category = r.category || getFileCategory(r.fileName);
              await db.runAsync(
                `INSERT OR REPLACE INTO uploaded_files (
                  uri, file_name, size, hash, uploaded_at, telegram_message_id,
                  chat_id, destination_title, media_asset_id, chunk_manifest,
                  cloud_status, last_verified_at, category
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  r.uri,
                  r.fileName || 'file',
                  r.size || 0,
                  r.hash ?? null,
                  r.uploadedAt || Date.now(),
                  r.telegramMessageId ?? null,
                  r.chatId ?? null,
                  r.destinationTitle ?? null,
                  r.mediaAssetId ?? null,
                  r.chunkManifest ? JSON.stringify(r.chunkManifest) : null,
                  r.cloudStatus || 'synced',
                  r.lastVerifiedAt ?? null,
                  category,
                ]
              );
            }
          });
        }
      } catch (err) {
        console.warn('[SQLite] Failed to parse/migrate uploaded records:', err);
      }
    }

    // 2. Queue Items
    const rawQueue = await AsyncStorage.getItem('@nimo/queue');
    if (rawQueue) {
      try {
        const queueList: QueueItem[] = JSON.parse(rawQueue);
        if (Array.isArray(queueList) && queueList.length > 0) {
          console.log(`[SQLite] Migrating ${queueList.length} queue items...`);
          await db.withTransactionAsync(async () => {
            for (const q of queueList) {
              await db.runAsync(
                `INSERT OR REPLACE INTO upload_queue (
                  id, uri, file_name, size, mime_type, media_asset_id,
                  status, progress, retries, added_at, last_attempt_at,
                  upload_started_at, uploaded_at, upload_duration_ms, error, speed_kbps
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  q.id || Crypto.randomUUID(),
                  q.uri,
                  q.fileName || 'file',
                  q.size || 0,
                  q.mimeType ?? null,
                  q.mediaAssetId ?? null,
                  q.status || 'pending',
                  q.progress || 0,
                  q.retries || 0,
                  q.addedAt || Date.now(),
                  q.lastAttemptAt ?? null,
                  q.uploadStartedAt ?? null,
                  q.uploadedAt ?? null,
                  q.uploadDurationMs ?? null,
                  q.error ?? null,
                  q.speedKbps ?? null,
                ]
              );
            }
          });
        }
      } catch (err) {
        console.warn('[SQLite] Failed to parse/migrate queue items:', err);
      }
    }

    // 3. Action History
    const rawHistory = await AsyncStorage.getItem('@nimo/action_history');
    if (rawHistory) {
      try {
        const historyList: ActionHistoryItem[] = JSON.parse(rawHistory);
        if (Array.isArray(historyList) && historyList.length > 0) {
          console.log(`[SQLite] Migrating ${historyList.length} action history items...`);
          await db.withTransactionAsync(async () => {
            for (const h of historyList) {
              await db.runAsync(
                `INSERT OR REPLACE INTO action_history (
                  id, file_name, uri, size, status, timestamp, upload_duration_ms, destination, error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  h.id || Crypto.randomUUID(),
                  h.fileName || 'file',
                  h.uri || '',
                  h.size || 0,
                  h.status || 'uploaded',
                  h.timestamp || Date.now(),
                  h.uploadDurationMs ?? null,
                  h.destination ?? null,
                  h.error ?? null,
                ]
              );
            }
          });
        }
      } catch (err) {
        console.warn('[SQLite] Failed to parse/migrate history items:', err);
      }
    }

    // 4. Chunk Manifests
    const rawManifests = await AsyncStorage.getItem('@nimo/chunk_manifests');
    if (rawManifests) {
      try {
        const manifests: Record<string, ChunkManifest> = JSON.parse(rawManifests);
        if (manifests && typeof manifests === 'object') {
          await db.withTransactionAsync(async () => {
            for (const [fileName, manifest] of Object.entries(manifests)) {
              await db.runAsync(
                `INSERT OR REPLACE INTO chunk_manifests (file_name, manifest_json) VALUES (?, ?)`,
                [fileName, JSON.stringify(manifest)]
              );
            }
          });
        }
      } catch (err) {
        console.warn('[SQLite] Failed to parse/migrate chunk manifests:', err);
      }
    }

    await db.runAsync(
      'INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)',
      ['migration_sqlite_v1', 'done']
    );
    console.log('[SQLite] Legacy data migration completed successfully!');
  } catch (err) {
    console.error('[SQLite] Error during migration:', err);
  }
}

async function initDatabaseInternal(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // Configure SQLite WAL mode for high concurrent throughput
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS uploaded_files (
      uri TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT,
      uploaded_at INTEGER NOT NULL,
      telegram_message_id INTEGER,
      chat_id INTEGER,
      destination_title TEXT,
      media_asset_id TEXT,
      chunk_manifest TEXT,
      cloud_status TEXT DEFAULT 'synced',
      last_verified_at INTEGER,
      category TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uploaded_uploaded_at ON uploaded_files(uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uploaded_category ON uploaded_files(category);
    CREATE INDEX IF NOT EXISTS idx_uploaded_hash ON uploaded_files(hash);
    CREATE INDEX IF NOT EXISTS idx_uploaded_chat_id ON uploaded_files(chat_id);
    CREATE INDEX IF NOT EXISTS idx_uploaded_cloud_status ON uploaded_files(cloud_status);

    CREATE TABLE IF NOT EXISTS upload_queue (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT,
      media_asset_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress REAL NOT NULL DEFAULT 0,
      retries INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL,
      last_attempt_at INTEGER,
      upload_started_at INTEGER,
      uploaded_at INTEGER,
      upload_duration_ms INTEGER,
      error TEXT,
      speed_kbps REAL
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status ON upload_queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_uri ON upload_queue(uri);
    CREATE INDEX IF NOT EXISTS idx_queue_added_at ON upload_queue(added_at ASC);

    CREATE TABLE IF NOT EXISTS action_history (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      uri TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      upload_duration_ms INTEGER,
      destination TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON action_history(timestamp DESC);

    CREATE TABLE IF NOT EXISTS chunk_manifests (
      file_name TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await migrateFromAsyncStorage(db);
  dbInstance = db;
  return db;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  if (!initPromise) {
    initPromise = initDatabaseInternal();
  }
  return initPromise;
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  return getDatabase();
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOADED FILES METHODS (NO 5,000 CAP, HIGH PERFORMANCE)
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllUploadedRecords(): Promise<UploadedRecord[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<UploadedRow>(
    'SELECT * FROM uploaded_files ORDER BY uploaded_at DESC'
  );
  return rows.map(rowToUploadedRecord);
}

export async function getUploadedFilesPaged(options: {
  category?: FileCategory | 'all';
  search?: string;
  chatId?: number;
  sort?: 'newest' | 'oldest' | 'size_desc' | 'size_asc' | 'name_asc';
  limit?: number;
  offset?: number;
} = {}): Promise<UploadedRecord[]> {
  const db = await getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.category && options.category !== 'all') {
    conditions.push('category = ?');
    params.push(options.category);
  }

  if (options.chatId !== undefined) {
    conditions.push('chat_id = ?');
    params.push(options.chatId);
  }

  if (options.search && options.search.trim()) {
    conditions.push('file_name LIKE ?');
    params.push(`%${options.search.trim()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = 'uploaded_at DESC';
  if (options.sort === 'oldest') orderBy = 'uploaded_at ASC';
  else if (options.sort === 'size_desc') orderBy = 'size DESC';
  else if (options.sort === 'size_asc') orderBy = 'size ASC';
  else if (options.sort === 'name_asc') orderBy = 'file_name COLLATE NOCASE ASC';

  const limitClause = options.limit !== undefined ? `LIMIT ${options.limit} OFFSET ${options.offset ?? 0}` : '';

  const sql = `SELECT * FROM uploaded_files ${whereClause} ORDER BY ${orderBy} ${limitClause}`.trim();
  const rows = await db.getAllAsync<UploadedRow>(sql, params);
  return rows.map(rowToUploadedRecord);
}

export async function countUploadedFiles(filter?: {
  category?: FileCategory | 'all';
  chatId?: number;
  search?: string;
}): Promise<number> {
  const db = await getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.category && filter.category !== 'all') {
    conditions.push('category = ?');
    params.push(filter.category);
  }

  if (filter?.chatId !== undefined) {
    conditions.push('chat_id = ?');
    params.push(filter.chatId);
  }

  if (filter?.search && filter.search.trim()) {
    conditions.push('file_name LIKE ?');
    params.push(`%${filter.search.trim()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT COUNT(*) as cnt FROM uploaded_files ${whereClause}`.trim();
  const res = await db.getFirstAsync<{ cnt: number }>(sql, params);
  return res?.cnt ?? 0;
}

export async function getUploadedRecordByUri(uri: string): Promise<UploadedRecord | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<UploadedRow>(
    'SELECT * FROM uploaded_files WHERE uri = ? LIMIT 1',
    [uri]
  );
  return row ? rowToUploadedRecord(row) : null;
}

export async function getUploadedRecordByHash(hash: string): Promise<UploadedRecord | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<UploadedRow>(
    'SELECT * FROM uploaded_files WHERE hash = ? LIMIT 1',
    [hash]
  );
  return row ? rowToUploadedRecord(row) : null;
}

export async function isFileUploaded(uri: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ one: number }>(
    'SELECT 1 as one FROM uploaded_files WHERE uri = ? LIMIT 1',
    [uri]
  );
  return !!row;
}

export async function markFileUploaded(record: UploadedRecord): Promise<void> {
  const db = await getDatabase();
  const category = record.category || getFileCategory(record.fileName);

  await db.runAsync(
    `INSERT OR REPLACE INTO uploaded_files (
      uri, file_name, size, hash, uploaded_at, telegram_message_id,
      chat_id, destination_title, media_asset_id, chunk_manifest,
      cloud_status, last_verified_at, category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.uri,
      record.fileName,
      record.size,
      record.hash ?? null,
      record.uploadedAt || Date.now(),
      record.telegramMessageId ?? null,
      record.chatId ?? null,
      record.destinationTitle ?? null,
      record.mediaAssetId ?? null,
      record.chunkManifest ? JSON.stringify(record.chunkManifest) : null,
      record.cloudStatus || 'synced',
      record.lastVerifiedAt ?? null,
      category,
    ]
  );
}

export async function markFilesUploadedBatch(records: UploadedRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const record of records) {
      const category = record.category || getFileCategory(record.fileName);
      await db.runAsync(
        `INSERT OR REPLACE INTO uploaded_files (
          uri, file_name, size, hash, uploaded_at, telegram_message_id,
          chat_id, destination_title, media_asset_id, chunk_manifest,
          cloud_status, last_verified_at, category
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.uri,
          record.fileName,
          record.size,
          record.hash ?? null,
          record.uploadedAt || Date.now(),
          record.telegramMessageId ?? null,
          record.chatId ?? null,
          record.destinationTitle ?? null,
          record.mediaAssetId ?? null,
          record.chunkManifest ? JSON.stringify(record.chunkManifest) : null,
          record.cloudStatus || 'synced',
          record.lastVerifiedAt ?? null,
          category,
        ]
      );
    }
  });
}

export async function saveUploadedIndex(records: UploadedRecord[]): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM uploaded_files');
    for (const record of records) {
      const category = record.category || getFileCategory(record.fileName);
      await db.runAsync(
        `INSERT INTO uploaded_files (
          uri, file_name, size, hash, uploaded_at, telegram_message_id,
          chat_id, destination_title, media_asset_id, chunk_manifest,
          cloud_status, last_verified_at, category
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.uri,
          record.fileName,
          record.size,
          record.hash ?? null,
          record.uploadedAt || Date.now(),
          record.telegramMessageId ?? null,
          record.chatId ?? null,
          record.destinationTitle ?? null,
          record.mediaAssetId ?? null,
          record.chunkManifest ? JSON.stringify(record.chunkManifest) : null,
          record.cloudStatus || 'synced',
          record.lastVerifiedAt ?? null,
          category,
        ]
      );
    }
  });
}

export async function updateUploadedRecord(
  uri: string,
  patch: Partial<UploadedRecord>
): Promise<UploadedRecord | null> {
  const existing = await getUploadedRecordByUri(uri);
  if (!existing) return null;

  const updated: UploadedRecord = { ...existing, ...patch };
  await markFileUploaded(updated);
  return updated;
}

export async function removeUploadedRecord(uri: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM uploaded_files WHERE uri = ?', [uri]);
}

export async function removeUploadedRecords(uris: string[]): Promise<void> {
  if (uris.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const uri of uris) {
      await db.runAsync('DELETE FROM uploaded_files WHERE uri = ?', [uri]);
    }
  });
}

export async function clearAllUploadedRecords(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM uploaded_files');
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE METHODS
// ─────────────────────────────────────────────────────────────────────────────

export async function getQueueItems(): Promise<QueueItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<QueueRow>(
    'SELECT * FROM upload_queue ORDER BY added_at ASC'
  );
  return rows.map(rowToQueueItem);
}

export async function saveQueueItems(queue: QueueItem[]): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM upload_queue');
    for (const q of queue) {
      await db.runAsync(
        `INSERT INTO upload_queue (
          id, uri, file_name, size, mime_type, media_asset_id,
          status, progress, retries, added_at, last_attempt_at,
          upload_started_at, uploaded_at, upload_duration_ms, error, speed_kbps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          q.id,
          q.uri,
          q.fileName,
          q.size,
          q.mimeType ?? null,
          q.mediaAssetId ?? null,
          q.status,
          q.progress,
          q.retries,
          q.addedAt,
          q.lastAttemptAt ?? null,
          q.uploadStartedAt ?? null,
          q.uploadedAt ?? null,
          q.uploadDurationMs ?? null,
          q.error ?? null,
          q.speedKbps ?? null,
        ]
      );
    }
  });
}

export async function addQueueItem(
  item: Omit<QueueItem, 'id' | 'status' | 'progress' | 'retries' | 'addedAt'>
): Promise<QueueItem> {
  const db = await getDatabase();
  // Dedup check: skip if active in queue
  const existingRow = await db.getFirstAsync<QueueRow>(
    "SELECT * FROM upload_queue WHERE uri = ? AND status != 'completed' LIMIT 1",
    [item.uri]
  );
  if (existingRow) {
    return rowToQueueItem(existingRow);
  }

  const newItem: QueueItem = {
    ...item,
    id: Crypto.randomUUID(),
    status: 'pending',
    progress: 0,
    retries: 0,
    addedAt: Date.now(),
  };

  await db.runAsync(
    `INSERT INTO upload_queue (
      id, uri, file_name, size, mime_type, media_asset_id,
      status, progress, retries, added_at, last_attempt_at,
      upload_started_at, uploaded_at, upload_duration_ms, error, speed_kbps
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newItem.id,
      newItem.uri,
      newItem.fileName,
      newItem.size,
      newItem.mimeType ?? null,
      newItem.mediaAssetId ?? null,
      newItem.status,
      newItem.progress,
      newItem.retries,
      newItem.addedAt,
      null,
      null,
      null,
      null,
      null,
      null,
    ]
  );

  return newItem;
}

export async function addManyQueueItems(
  items: Omit<QueueItem, 'id' | 'status' | 'progress' | 'retries' | 'addedAt'>[]
): Promise<{ added: QueueItem[]; skipped: number }> {
  if (items.length === 0) return { added: [], skipped: 0 };
  const db = await getDatabase();

  const existingRows = await db.getAllAsync<{ uri: string }>(
    "SELECT uri FROM upload_queue WHERE status != 'completed'"
  );
  const existingUris = new Set(existingRows.map((r) => r.uri));

  const now = Date.now();
  const added: QueueItem[] = [];
  let skipped = 0;

  await db.withTransactionAsync(async () => {
    for (const item of items) {
      if (existingUris.has(item.uri)) {
        skipped++;
        continue;
      }

      const newItem: QueueItem = {
        ...item,
        id: Crypto.randomUUID(),
        status: 'pending',
        progress: 0,
        retries: 0,
        addedAt: now,
      };

      await db.runAsync(
        `INSERT INTO upload_queue (
          id, uri, file_name, size, mime_type, media_asset_id,
          status, progress, retries, added_at, last_attempt_at,
          upload_started_at, uploaded_at, upload_duration_ms, error, speed_kbps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newItem.id,
          newItem.uri,
          newItem.fileName,
          newItem.size,
          newItem.mimeType ?? null,
          newItem.mediaAssetId ?? null,
          newItem.status,
          newItem.progress,
          newItem.retries,
          newItem.addedAt,
          null,
          null,
          null,
          null,
          null,
          null,
        ]
      );

      added.push(newItem);
      existingUris.add(item.uri);
    }
  });

  return { added, skipped };
}

export async function updateQueueItem(
  id: string,
  patch: Partial<QueueItem>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const params: any[] = [];

  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.progress !== undefined) { sets.push('progress = ?'); params.push(patch.progress); }
  if (patch.retries !== undefined) { sets.push('retries = ?'); params.push(patch.retries); }
  if (patch.lastAttemptAt !== undefined) { sets.push('last_attempt_at = ?'); params.push(patch.lastAttemptAt); }
  if (patch.uploadStartedAt !== undefined) { sets.push('upload_started_at = ?'); params.push(patch.uploadStartedAt); }
  if (patch.uploadedAt !== undefined) { sets.push('uploaded_at = ?'); params.push(patch.uploadedAt); }
  if (patch.uploadDurationMs !== undefined) { sets.push('upload_duration_ms = ?'); params.push(patch.uploadDurationMs); }
  if (patch.error !== undefined) { sets.push('error = ?'); params.push(patch.error); }
  if (patch.speedKbps !== undefined) { sets.push('speed_kbps = ?'); params.push(patch.speedKbps); }

  if (sets.length === 0) return;
  params.push(id);

  await db.runAsync(`UPDATE upload_queue SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function removeQueueItem(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM upload_queue WHERE id = ?', [id]);
}

export async function clearQueue(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM upload_queue');
}

export async function resetQueueItemToPending(id: string): Promise<QueueItem | null> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE upload_queue SET status = 'pending', progress = 0, error = NULL, last_attempt_at = NULL WHERE id = ?",
    [id]
  );
  const row = await db.getFirstAsync<QueueRow>('SELECT * FROM upload_queue WHERE id = ?', [id]);
  return row ? rowToQueueItem(row) : null;
}

export async function recoverInterruptedUploads(): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    "UPDATE upload_queue SET status = 'pending', progress = 0, speed_kbps = NULL, error = NULL WHERE status = 'uploading'"
  );
  const changes = res.changes || 0;
  if (changes > 0) {
    console.log(`[SQLite] Auto-recovered ${changes} interrupted upload item(s) back to pending.`);
  }
  return changes;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION HISTORY METHODS
// ─────────────────────────────────────────────────────────────────────────────

export async function getActionHistoryItems(limit: number = 500): Promise<ActionHistoryItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<HistoryRow>(
    'SELECT * FROM action_history ORDER BY timestamp DESC LIMIT ?',
    [limit]
  );
  return rows.map(rowToActionHistoryItem);
}

export async function recordActionHistoryItem(
  item: Omit<ActionHistoryItem, 'id' | 'timestamp'>
): Promise<ActionHistoryItem> {
  const db = await getDatabase();
  const newItem: ActionHistoryItem = {
    ...item,
    id: Crypto.randomUUID(),
    timestamp: Date.now(),
  };

  await db.runAsync(
    `INSERT INTO action_history (
      id, file_name, uri, size, status, timestamp, upload_duration_ms, destination, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newItem.id,
      newItem.fileName,
      newItem.uri,
      newItem.size,
      newItem.status,
      newItem.timestamp,
      newItem.uploadDurationMs ?? null,
      newItem.destination ?? null,
      newItem.error ?? null,
    ]
  );

  return newItem;
}

export async function recordActionHistoryBatch(
  items: Omit<ActionHistoryItem, 'id' | 'timestamp'>[]
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDatabase();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO action_history (
          id, file_name, uri, size, status, timestamp, upload_duration_ms, destination, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Crypto.randomUUID(),
          item.fileName,
          item.uri,
          item.size,
          item.status,
          now,
          item.uploadDurationMs ?? null,
          item.destination ?? null,
          item.error ?? null,
        ]
      );
    }
  });
}

export async function clearActionHistory(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM action_history');
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNK MANIFEST METHODS
// ─────────────────────────────────────────────────────────────────────────────

export async function saveChunkManifest(
  fileName: string,
  manifest: ChunkManifest
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO chunk_manifests (file_name, manifest_json) VALUES (?, ?)',
    [fileName, JSON.stringify(manifest)]
  );
}

export async function getChunkManifest(
  fileName: string
): Promise<ChunkManifest | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ manifest_json: string }>(
    'SELECT manifest_json FROM chunk_manifests WHERE file_name = ? LIMIT 1',
    [fileName]
  );
  if (!row) return null;
  try {
    return JSON.parse(row.manifest_json);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACID ATOMIC TRANSACTION: COMPLETE UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

export async function completeUploadAtomically(params: {
  queueId: string;
  uri: string;
  fileName: string;
  size: number;
  hash?: string;
  telegramMessageId?: number;
  chatId?: number;
  destinationTitle?: string;
  mediaAssetId?: string;
  uploadedAt: number;
  uploadDurationMs: number;
  destination: string;
  chunkManifest?: ChunkManifest;
}): Promise<void> {
  const db = await getDatabase();
  const category = getFileCategory(params.fileName);
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    // 1. Mark item completed in upload_queue
    await db.runAsync(
      `UPDATE upload_queue
       SET status = 'completed', progress = 100, uploaded_at = ?, upload_duration_ms = ?, last_attempt_at = ?
       WHERE id = ?`,
      [params.uploadedAt, params.uploadDurationMs, now, params.queueId]
    );

    // 2. Upsert record into uploaded_files
    await db.runAsync(
      `INSERT OR REPLACE INTO uploaded_files (
        uri, file_name, size, hash, uploaded_at, telegram_message_id,
        chat_id, destination_title, media_asset_id, chunk_manifest,
        cloud_status, last_verified_at, category
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)`,
      [
        params.uri,
        params.fileName,
        params.size,
        params.hash ?? null,
        params.uploadedAt,
        params.telegramMessageId ?? null,
        params.chatId ?? null,
        params.destinationTitle ?? null,
        params.mediaAssetId ?? null,
        params.chunkManifest ? JSON.stringify(params.chunkManifest) : null,
        now,
        category,
      ]
    );

    // 3. Insert action history item
    await db.runAsync(
      `INSERT INTO action_history (
        id, file_name, uri, size, status, timestamp, upload_duration_ms, destination, error
      ) VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?, NULL)`,
      [
        Crypto.randomUUID(),
        params.fileName,
        params.uri,
        params.size,
        now,
        params.uploadDurationMs,
        params.destination,
      ]
    );
  });
}
