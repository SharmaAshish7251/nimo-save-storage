import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import {
  getConfig,
  saveConfig,
  getWatchedFolders,
  saveWatchedFolders,
  getUploadedIndex,
  saveUploadedIndex,
  saveChunkManifest,
  getChunkManifest,
  AppConfig,
  WatchedFolder,
  UploadedRecord,
  onConfigSaved,
} from './queue';
import { vaultService, VaultSyncMetadata } from '../crypto/vault';
import { tdLibClient } from '../tdlib/client';
import { reconcileCloudIndex } from './cloudSync';
import type { ChunkManifest } from './reassembler';

export const PROFILE_FILE_NAME = 'nimo_cloud_profile_v1.json';
export const PROFILE_CAPTION = '[NIMO_CLOUD_PROFILE_V1] Nimo Save & Storage Cloud Profile Backup';
export const PROFILE_RESTORED_FLAG = '@nimo/cloud_restored';
export const PROFILE_SYNC_KEY = '@nimo/profile_sync_meta';

export interface NimoCloudProfileV1 {
  schemaVersion: 1;
  updatedAt: number;
  deviceId: string;
  config: AppConfig;
  watchedFolders: WatchedFolder[];
  vault: VaultSyncMetadata;
  uploadedIndex: UploadedRecord[];
  chunkManifests?: Record<string, ChunkManifest>;
  onboardingDone: boolean;
}

export interface ProfileSyncMeta {
  lastPushedAt?: number;
  lastRestoredAt?: number;
  lastProfileMessageId?: number;
}

let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function getProfileSyncMeta(): Promise<ProfileSyncMeta> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_SYNC_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveProfileSyncMeta(meta: Partial<ProfileSyncMeta>): Promise<void> {
  try {
    const current = await getProfileSyncMeta();
    await AsyncStorage.setItem(PROFILE_SYNC_KEY, JSON.stringify({ ...current, ...meta }));
  } catch {}
}

function hasPrototypePollution(obj: any, depth = 0): boolean {
  if (!obj || typeof obj !== 'object' || depth > 10) return false;
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasPrototypePollution(obj[key], depth + 1)) return true;
    }
  }
  return false;
}

export function validateCloudProfile(data: any): data is NimoCloudProfileV1 {
  if (!data || typeof data !== 'object') return false;
  if (hasPrototypePollution(data)) return false;
  if (data.schemaVersion !== 1) return false;
  if (typeof data.updatedAt !== 'number') return false;
  if (typeof data.deviceId !== 'string') return false;
  if (!data.config || typeof data.config !== 'object') return false;
  return true;
}

const ALLOWED_CONFIG_KEYS: (keyof AppConfig)[] = [
  // Watched folders / paths
  'watchFolders',
  'watchedFolders',
  // Upload behaviour
  'wifiOnly',
  'onlyWhenCharging',
  'batteryGuard',
  'batteryGuardThreshold',
  'syncOnPlug',
  'autoUploadEnabled',
  'concurrency',
  'duplicatePolicy',
  // File filters
  'minFileSizeKb',
  'maxFileSizeBytes',
  'excludedExtensions',
  // Schedule
  'scheduleMode',
  'intervalMinutes',
  'timeWindowStart',
  'timeWindowEnd',
  // Telegram destination (single-stream)
  'uploadToSavedMessages',
  'targetChatId',
  'targetChatTitle',
  'targetChatType',
  // Multi-channel categorical routing
  'multiChannelRouting',
  'photoChannelId',
  'photoChannelTitle',
  'videoChannelId',
  'videoChannelTitle',
  'documentChannelId',
  'documentChannelTitle',
  // Custom file types
  'customFileTypes',
  // Security
  'vaultEnabled',
  'biometricLockEnabled',
  'biometricLockTimeout',
  // UX
  'notifyOnComplete',
  'themeMode',
];

function sanitizeConfig(config: any): AppConfig {
  const sanitized: any = {};
  for (const key of ALLOWED_CONFIG_KEYS) {
    if (key in config) {
      sanitized[key] = config[key];
    }
  }
  return sanitized as AppConfig;
}

/**
 * Searches the user's Saved Messages chat for the latest cloud profile backup.
 * Paginates up to 5 pages of 100 messages (QUAL-04).
 */
export async function findLatestCloudProfileMessage(): Promise<{ messageId: number; chatId: number; docFile: any } | null> {
  try {
    const savedChatId = await tdLibClient.getSavedMessagesChatId();
    if (!savedChatId) return null;

    let fromMessageId = 0;
    const MAX_PAGES = 5;

    for (let page = 0; page < MAX_PAGES; page++) {
      const messages = await tdLibClient.getChatHistory(savedChatId, fromMessageId, 100, 0);
      if (!Array.isArray(messages) || messages.length === 0) break;

      for (const msg of messages) {
        if (!msg || !msg.id) continue;
        const content = msg.content;
        if (!content) continue;

        const caption = content.caption?.text || (typeof content.caption === 'string' ? content.caption : '');
        const doc = content.document;
        const fileName = doc?.file_name || doc?.fileName || '';

        const isProfile =
          caption.includes('[NIMO_CLOUD_PROFILE_V1]') ||
          fileName === PROFILE_FILE_NAME ||
          fileName.toLowerCase().includes('nimo_cloud_profile');

        if (isProfile) {
          return {
            messageId: msg.id,
            chatId: savedChatId,
            docFile: doc?.document || doc || null,
          };
        }
      }

      fromMessageId = messages[messages.length - 1]?.id || 0;
      if (!fromMessageId) break;
    }
  } catch (err) {
    console.warn('[CloudProfileSync] findLatestCloudProfileMessage error:', err);
  }
  return null;
}

/**
 * Pushes a fresh profile snapshot JSON file to Telegram Saved Messages.
 * Rotates old profile messages so only the newest snapshot is retained.
 */
export async function pushCloudProfileSnapshot(
  force: boolean = false
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  try {
    const isLoggedIn = await tdLibClient.isLoggedIn().catch(() => false);
    if (!isLoggedIn) {
      return { success: false, error: 'NOT_LOGGED_IN' };
    }

    const savedChatId = await tdLibClient.getSavedMessagesChatId();
    if (!savedChatId) {
      return { success: false, error: 'NO_SAVED_MESSAGES_CHAT' };
    }

    const [config, watchedFolders, uploadedIndex, onboardingDoneRaw] = await Promise.all([
      getConfig(),
      getWatchedFolders(),
      getUploadedIndex(),
      AsyncStorage.getItem('nimo_onboarding_done'),
    ]);

    const vaultMeta = await vaultService.exportVaultSyncMetadata(config.vaultEnabled ?? false);

    // Collect chunk manifests for any multi-part uploaded files
    const chunkManifests: Record<string, ChunkManifest> = {};
    for (const record of uploadedIndex) {
      if (record.chunkManifest) {
        chunkManifests[record.fileName] = record.chunkManifest;
      } else {
        const stored = await getChunkManifest(record.fileName);
        if (stored) {
          chunkManifests[record.fileName] = stored;
        }
      }
    }

    const deviceId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const profileData: NimoCloudProfileV1 = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      deviceId,
      config,
      watchedFolders,
      vault: vaultMeta,
      uploadedIndex,
      chunkManifests: Object.keys(chunkManifests).length > 0 ? chunkManifests : undefined,
      onboardingDone: onboardingDoneRaw === 'true',
    };

    const tempDir = `${FileSystem.cacheDirectory}nimo_profile/`;
    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => {});
    const tempFilePath = `${tempDir}${PROFILE_FILE_NAME}`;
    await FileSystem.writeAsStringAsync(tempFilePath, JSON.stringify(profileData, null, 2), {
      encoding: 'utf8',
    });

    // Check for previous snapshot to delete after new one is sent
    const existing = await findLatestCloudProfileMessage().catch(() => null);

    console.log('[CloudProfileSync] Uploading fresh cloud profile snapshot to Saved Messages...');
    const result = await tdLibClient.sendFile(
      tempFilePath,
      PROFILE_FILE_NAME,
      String(savedChatId),
      undefined,
      PROFILE_CAPTION
    );

    // Clean up temporary local JSON file
    await FileSystem.deleteAsync(tempFilePath, { idempotent: true }).catch(() => {});

    // Delete previous profile message in Telegram Cloud to prevent clutter
    if (existing?.messageId && existing.messageId !== result.id) {
      await tdLibClient.deleteCloudMessages(savedChatId, [existing.messageId], true).catch(() => {});
    }

    await saveProfileSyncMeta({
      lastPushedAt: Date.now(),
      lastProfileMessageId: result.id,
    });

    console.log('[CloudProfileSync] Successfully pushed profile snapshot. Message ID:', result.id);
    return { success: true, messageId: result.id };
  } catch (err: any) {
    console.error('[CloudProfileSync] pushCloudProfileSnapshot error:', err);
    return { success: false, error: err?.message || 'Push failed' };
  }
}

/**
 * Schedules a debounced push (default 3 seconds) so frequent changes
 * don't generate multiple upload requests.
 */
export function scheduleCloudProfilePush(delayMs: number = 3000): void {
  if (pushDebounceTimer) {
    clearTimeout(pushDebounceTimer);
  }
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    pushCloudProfileSnapshot().catch((err) => {
      console.warn('[CloudProfileSync] Debounced push error:', err);
    });
  }, delayMs);
}

let restoreInFlightPromise: Promise<{
  restored: boolean;
  profile?: NimoCloudProfileV1;
  needsVaultUnlock?: boolean;
  needsSafReauthorization?: boolean;
  reason?: string;
}> | null = null;

/**
 * Downloads and restores user data, settings, vault metadata, and uploaded index
 * from Telegram Saved Messages on a fresh installation.
 */
export async function restoreFromCloudProfile(options: {
  force?: boolean;
} = {}): Promise<{
  restored: boolean;
  profile?: NimoCloudProfileV1;
  needsVaultUnlock?: boolean;
  needsSafReauthorization?: boolean;
  reason?: string;
}> {
  if (restoreInFlightPromise && !options.force) {
    console.log('[CloudProfileSync] Restore already in-flight, awaiting active operation...');
    return restoreInFlightPromise;
  }

  const promise = (async () => {
    try {
      const isLoggedIn = await tdLibClient.isLoggedIn().catch(() => false);
      if (!isLoggedIn) {
        return { restored: false, reason: 'NOT_LOGGED_IN' };
      }

      const latest = await findLatestCloudProfileMessage();
      if (!latest) {
        return { restored: false, reason: 'NO_PROFILE_FOUND' };
      }

      console.log('[CloudProfileSync] Found profile message:', latest.messageId, 'Downloading file...');
      const downloadedPath = await tdLibClient.downloadMessageFile(latest.chatId, latest.messageId);
      if (!downloadedPath) {
        return { restored: false, reason: 'FILE_DOWNLOAD_FAILED' };
      }

      const safeUri = downloadedPath.startsWith('file://') ? downloadedPath : `file://${downloadedPath}`;
      console.log('[CloudProfileSync] Profile downloaded to:', safeUri);

      // Verify file presence on disk
      const info = await FileSystem.getInfoAsync(safeUri).catch(() => ({ exists: false } as any));
      if (!info.exists) {
        // Small grace pause for native filesystem flush
        await new Promise((r) => setTimeout(r, 200));
        const retry = await FileSystem.getInfoAsync(safeUri).catch(() => ({ exists: false } as any));
        if (!retry.exists) {
          console.error('[CloudProfileSync] Downloaded profile file not found on disk at:', safeUri);
          return { restored: false, reason: 'FILE_NOT_FOUND_ON_DISK' };
        }
      }

      const fileContent = await FileSystem.readAsStringAsync(safeUri, { encoding: 'utf8' });
      if (!fileContent || !fileContent.trim()) {
        console.error('[CloudProfileSync] Profile file is empty');
        return { restored: false, reason: 'EMPTY_PROFILE_PAYLOAD' };
      }

      let profile: NimoCloudProfileV1;
      try {
        profile = JSON.parse(fileContent);
      } catch (parseErr) {
        console.error('[CloudProfileSync] Failed to parse profile JSON:', parseErr);
        return { restored: false, reason: 'INVALID_PROFILE_DATA' };
      }

      if (!validateCloudProfile(profile)) {
        console.error('[CloudProfileSync] Profile validation failed (schema/type/prototype mismatch)');
        return { restored: false, reason: 'INVALID_OR_UNSUPPORTED_PROFILE' };
      }

      // 1. Restore App Configuration (whitelist sanitized against unexpected keys)
      if (profile.config) {
        await saveConfig(sanitizeConfig(profile.config), { skipSync: true });
      }

      // 2. Restore Watched Folders with smart album re-matching and SAF flagging
      let needsSafReauthorization = false;
      if (Array.isArray(profile.watchedFolders)) {
        let deviceAlbums: MediaLibrary.Album[] = [];
        try {
          const hasPerm = await MediaLibrary.getPermissionsAsync();
          if (hasPerm.granted) {
            deviceAlbums = await MediaLibrary.getAlbumsAsync();
          }
        } catch (albumErr) {
          console.warn('[CloudProfileSync] MediaLibrary album listing warning:', albumErr);
        }

        const restoredFolders: WatchedFolder[] = profile.watchedFolders.map((f) => {
          if (f.type === 'album') {
            const match = deviceAlbums.find(
              (a) => a.title.toLowerCase() === f.title.toLowerCase()
            );
            if (match) {
              return {
                ...f,
                id: match.id,
                assetCount: match.assetCount,
              };
            }
          } else if (f.type === 'saf') {
            needsSafReauthorization = true;
            return {
              ...f,
              needsPermission: true,
            };
          }
          return f;
        });

        await saveWatchedFolders(restoredFolders);
      }

      // 3. Restore Vault Metadata
      let needsVaultUnlock = false;
      if (profile.vault) {
        await vaultService.importVaultSyncMetadata(profile.vault);
        if (profile.vault.enabled && profile.vault.keyVerifier) {
          needsVaultUnlock = true;
        }
      }

      // 4. Restore Uploaded Index and Chunk Manifests
      if (Array.isArray(profile.uploadedIndex)) {
        await saveUploadedIndex(profile.uploadedIndex);
      }

      if (profile.chunkManifests) {
        for (const [fileName, manifest] of Object.entries(profile.chunkManifests)) {
          await saveChunkManifest(fileName, manifest);
        }
      }

      // 5. Restore Onboarding Status
      if (profile.onboardingDone) {
        await AsyncStorage.setItem('nimo_onboarding_done', 'true');
      }

      // Mark as restored so automatic login check doesn't overwrite subsequent local edits
      await AsyncStorage.setItem(PROFILE_RESTORED_FLAG, 'true');
      await saveProfileSyncMeta({
        lastRestoredAt: Date.now(),
        lastProfileMessageId: latest.messageId,
      });

      // Run background cloud reconciliation against Telegram to confirm remote message existence
      reconcileCloudIndex({ forceAll: false }).catch(() => {});

      console.log('[CloudProfileSync] Cloud profile restored successfully!');
      return {
        restored: true,
        profile,
        needsVaultUnlock,
        needsSafReauthorization,
      };
    } catch (err: any) {
      console.error('[CloudProfileSync] restoreFromCloudProfile error:', err);
      return { restored: false, reason: err?.message || 'Restore failed' };
    }
  })();

  restoreInFlightPromise = promise;
  try {
    return await promise;
  } finally {
    restoreInFlightPromise = null;
  }
}

// Hook automatic debounced sync whenever AppConfig is saved
onConfigSaved(() => {
  scheduleCloudProfilePush();
});

