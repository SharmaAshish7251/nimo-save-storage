import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import TdLib from 'react-native-tdlib';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { getApiCredentials } from '../storage/secure';
import { resolveToLocalPath, cleanupTempFile } from './fileHelper';
import { TdAuthState, TdFile, TdUploadProgress, TdUser, TelegramDestination } from './types';

export const DEFAULT_API_ID = 2040;
export const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

type AuthStateListener = (state: TdAuthState) => void;
type UpdateListener = (type: string, raw: any) => void;

class TdLibClientService {
  private eventEmitter: NativeEventEmitter | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private currentAuthState: TdAuthState = 'unknown';
  private authListeners: Set<AuthStateListener> = new Set();
  private updateListeners: Set<UpdateListener> = new Set();
  private activeUploads: Map<number, (progress: TdUploadProgress) => void> = new Map();
  private myUserId: number | null = null;
  private hasWarnedMissing = false;

  constructor() {
    this.setupEventEmitter();
  }

  public isAvailable(): boolean {
    const available = Boolean(NativeModules.TdLibModule);
    if (!available && !this.hasWarnedMissing) {
      this.hasWarnedMissing = true;
      console.warn(
        '[TdLibClientService] TdLibModule NOT found in NativeModules. ' +
          'A Development Build APK (not Expo Go) is required for native TDLib.'
      );
    }
    return available;
  }

  private setupEventEmitter() {
    if (this.eventEmitter) return;
    try {
      const tdModule = NativeModules.TdLibModule;
      if (tdModule) {
        this.eventEmitter = new NativeEventEmitter(tdModule);
        this.eventEmitter.addListener('tdlib-update', (event: any) => {
          this.handleUpdate(event);
        });
      }
    } catch (err) {
      console.warn('[TdLibClientService] Failed to set up NativeEventEmitter:', err);
    }
  }

  private handleUpdate(event: { type: string; raw: string }) {
    if (!event || !event.raw) return;

    let parsed: any;
    try {
      parsed = JSON.parse(event.raw);
    } catch {
      return;
    }

    const type = event.type || parsed['@type'];

    // Notify generic update listeners
    for (const listener of this.updateListeners) {
      try {
        listener(type, parsed);
      } catch (err) {
        console.error('[TdLibClientService] Error in updateListener:', err);
      }
    }

    // Handle Auth state updates
    if (type === 'updateAuthorizationState' || parsed['@type'] === 'updateAuthorizationState') {
      const stateObj = parsed.authorization_state || parsed.authorizationState;
      const stateType = (stateObj?.['@type'] || stateObj) as TdAuthState;
      if (stateType) {
        this.currentAuthState = stateType;
        if (stateType === 'authorizationStateClosed') {
          this.isInitialized = false;
        }
        for (const listener of this.authListeners) {
          try {
            listener(stateType);
          } catch (err) {
            console.error('[TdLibClientService] Error in authListener:', err);
          }
        }
      }
    }
  }

  public async init(force: boolean = false): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error(
        'Native TDLib module not found. Make sure you are running the Development Build APK (not Expo Go) where native libraries are linked.'
      );
    }

    if (!force && this.isInitialized) {
      try {
        const rawState = await TdLib.getAuthorizationState();
        const parsed = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
        const type = parsed?.['@type'] || parsed;
        if (type && type !== 'authorizationStateClosed' && type !== 'authorizationStateWaitTdlibParameters') {
          return; // Native client is alive and healthy
        }
      } catch {
        // Native client is null or closed, proceed with fresh initialization
      }
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      this.isInitialized = false;
      this.setupEventEmitter();

      const creds = await getApiCredentials();
      const apiId = creds.apiId ? parseInt(creds.apiId, 10) : DEFAULT_API_ID;
      const apiHash = creds.apiHash || DEFAULT_API_HASH;

      try {
        console.log('[TdLibClientService] Starting TDLib with API ID:', apiId);
        await TdLib.startTdLib({
          api_id: apiId,
          api_hash: apiHash,
          device_model: Platform.OS === 'android' ? 'Android Device' : 'iOS Device',
          system_version: String(Platform.Version),
          application_version: '1.0.0',
          system_language_code: 'en',
        });
        this.isInitialized = true;
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (msg.includes('already started') || msg.includes('already initialized')) {
          this.isInitialized = true;
        } else {
          throw err;
        }
      }

      // Check if TDLib is still waiting for parameters (can happen across hot reloads)
      try {
        const rawState = await TdLib.getAuthorizationState();
        const parsed = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
        const type = parsed?.['@type'] || parsed;
        if (type === 'authorizationStateWaitTdlibParameters') {
          console.log('[TdLibClientService] TDLib waiting for parameters, sending setTdlibParameters...');
          await TdLib.td_json_client_send({
            '@type': 'setTdlibParameters',
            database_directory: `${(LegacyFileSystem.documentDirectory ?? '').replace(/^file:\/\//, '')}tdlib`,
            use_message_database: true,
            use_secret_chats: true,
            api_id: apiId,
            api_hash: apiHash,
            system_language_code: 'en',
            device_model: Platform.OS === 'android' ? 'Android Device' : 'iOS Device',
            system_version: String(Platform.Version),
            application_version: '1.0.0',
            use_file_database: true,
          }).catch((e) => console.warn('[TdLibClientService] setTdlibParameters send:', e));
        }
      } catch (e) {
        console.warn('[TdLibClientService] Error verifying auth state post-init:', e);
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  public async getAuthState(): Promise<TdAuthState> {
    await this.init();
    try {
      const raw = await TdLib.getAuthorizationState();
      console.log('[TdLibClientService] raw getAuthorizationState:', raw);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const state = (parsed?.['@type'] || parsed) as TdAuthState;
      console.log('[TdLibClientService] resolved state:', state);
      if (state) {
        this.currentAuthState = state;
      }
      return this.currentAuthState;
    } catch (err) {
      console.error('[TdLibClientService] getAuthState error:', err);
      return this.currentAuthState;
    }
  }

  public async isLoggedIn(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const state = await this.getAuthState();
    return state === 'authorizationStateReady';
  }

  public onAuthStateChange(listener: AuthStateListener): () => void {
    this.authListeners.add(listener);
    return () => {
      this.authListeners.delete(listener);
    };
  }

  public addUpdateListener(listener: UpdateListener): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  public async loginWithPhone(phoneNumber: string): Promise<string> {
    await this.init();
    const clean = phoneNumber.replace(/[^\d+]/g, '');
    let countryCode = '';
    let number = clean;
    if (clean.startsWith('+')) {
      countryCode = '+';
      number = clean.slice(1);
    }

    try {
      return await TdLib.login({ countrycode: countryCode, phoneNumber: number });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('null object reference') || msg.includes('CLIENT_NOT_INITIALIZED')) {
        console.warn('[TdLibClientService] Native client null on login, re-initializing TDLib...');
        await this.init(true);
        return await TdLib.login({ countrycode: countryCode, phoneNumber: number });
      }
      throw err;
    }
  }

  public async verifyCode(code: string): Promise<string> {
    await this.init();
    try {
      return await TdLib.verifyPhoneNumber(code.trim());
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('null object reference') || msg.includes('CLIENT_NOT_INITIALIZED')) {
        console.warn('[TdLibClientService] Native client null on verifyCode, re-initializing TDLib...');
        await this.init(true);
        return await TdLib.verifyPhoneNumber(code.trim());
      }
      throw err;
    }
  }

  public async verifyPassword(password: string): Promise<string> {
    await this.init();
    try {
      return await TdLib.verifyPassword(password);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('null object reference') || msg.includes('CLIENT_NOT_INITIALIZED')) {
        console.warn('[TdLibClientService] Native client null on verifyPassword, re-initializing TDLib...');
        await this.init(true);
        return await TdLib.verifyPassword(password);
      }
      throw err;
    }
  }

  public async getMe(): Promise<TdUser> {
    await this.init();
    try {
      const raw = await TdLib.getProfile();
      const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (user?.id) {
        this.myUserId = user.id;
      }
      return user;
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('null object reference') || msg.includes('CLIENT_NOT_INITIALIZED')) {
        await this.init(true);
        const raw = await TdLib.getProfile();
        const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (user?.id) {
          this.myUserId = user.id;
        }
        return user;
      }
      throw err;
    }
  }

  public async getSavedMessagesChatId(): Promise<number> {
    const me = await this.getMe();
    try {
      const res = await TdLib.createPrivateChat(me.id);
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      if (parsed?.id) {
        this.myUserId = parsed.id;
        return parsed.id;
      }
    } catch (e) {
      console.warn('[TdLib] createPrivateChat for Saved Messages failed:', e);
    }
    return me.id;
  }

  /**
   * Uploads and sends a file via native TDLib MTProto engine.
   * TDLib streams the local file directly using C++ MTProto (10-30 MB/s).
   */
  public async sendFile(
    uri: string,
    fileName: string,
    targetChat: string = 'me',
    onProgress?: (progress: number) => void,
    caption?: string
  ): Promise<{ id: number }> {
    await this.init();

    // 1. Resolve to native absolute filesystem path
    const { path: localPath, isTemp } = await resolveToLocalPath(uri);

    const targetChatId = await this.resolveTargetChatId(targetChat);

    const normalizePath = (p?: string): string => {
      if (!p) return '';
      return p
        .replace(/^file:\/\//, '')
        .replace(/^\/data\/user\/0\//, '/data/data/')
        .trim();
    };

    const pathsMatch = (p1?: string, p2?: string): boolean => {
      if (!p1 || !p2) return false;
      const n1 = normalizePath(p1);
      const n2 = normalizePath(p2);
      if (n1 === n2) return true;
      const base1 = n1.split('/').pop();
      const base2 = n2.split('/').pop();
      return Boolean(base1 && base2 && base1 === base2);
    };

    return new Promise((resolve, reject) => {
      let fileId: number | null = null;
      let sentMessageId: number | null = null;
      let timeoutId: any = null;
      let isDone = false;

      const cleanup = async () => {
        isDone = true;
        if (fileId !== null) {
          this.activeUploads.delete(fileId);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.updateListeners.delete(updateHandler);
        if (isTemp) {
          await cleanupTempFile(localPath);
        }
      };

      // 15 minute upload timeout safety
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('TDLib upload timed out after 15 minutes'));
      }, 15 * 60 * 1000);

      const updateHandler = (rawType: string, data: any) => {
        if (isDone) return;
        const type = (rawType || '').toLowerCase();

        // 0. Immediate error response from TDLib (e.g. Chat not found, File error)
        if (type === 'error' && data) {
          const errCode = data.code ?? data['@extra'] ?? 400;
          const errMsg = data.message || 'TDLib operation failed';
          console.error('[TdLib sendFile] Received TDLib error:', errCode, errMsg);
          cleanup();
          reject(new Error(`TDLib error [${errCode}]: ${errMsg}`));
          return;
        }

        // 1. Track file upload progress via updateFile
        if (type === 'updatefile' && data?.file) {
          const file: TdFile = data.file;
          const filePath = file.local?.path;

          if (fileId === null && filePath && pathsMatch(filePath, localPath)) {
            fileId = file.id;
            console.log('[TdLib sendFile] Linked fileId from updateFile:', fileId);
          }

          if (fileId !== null && file.id === fileId) {
            const uploadedSize = file.remote?.uploaded_size ?? (file.remote as any)?.uploadedSize ?? 0;
            const totalSize = file.expected_size ?? (file as any)?.expectedSize ?? file.size ?? 1;
            const progress = Math.min(1, Math.max(0, uploadedSize / totalSize));
            if (onProgress) {
              onProgress(progress);
            }

            const isCompleted = file.remote?.is_uploading_completed ?? (file.remote as any)?.isUploadingCompleted;
            if (isCompleted && onProgress) {
              onProgress(1);
            }
          }
        }

        // 2. Track outgoing message creation (via direct result or updateNewMessage)
        const isMsg = type === 'message' || type === 'updatenewmessage';
        const msg = type === 'message' ? data : data?.message;
        if (isMsg && msg) {
          const isOurChat = String(msg.chat_id ?? msg.chatId) === String(targetChatId);
          if (isOurChat) {
            const doc = msg.content?.document;
            const docFileName = doc?.file_name ?? doc?.fileName;
            const captionText = msg.content?.caption?.text;
            const docPath = doc?.document?.local?.path;
            const docFileId = doc?.document?.id;

            const matchesDoc =
              (docPath && pathsMatch(docPath, localPath)) ||
              (docFileName && docFileName === fileName) ||
              (captionText && captionText === fileName) ||
              (fileId !== null && docFileId === fileId);

            if (matchesDoc) {
              sentMessageId = msg.id;
              if (docFileId) {
                fileId = docFileId;
              }
              console.log('[TdLib sendFile] Found outgoing message id:', sentMessageId, 'fileId:', fileId);
            }
          }
        }

        // 3. Track when message upload and send succeeds
        if (type === 'updatemessagesendsucceeded' && data?.message) {
          const msg = data.message;
          const oldId = data.old_message_id ?? data.oldMessageId;
          const doc = msg.content?.document;
          const docFileId = doc?.document?.id;

          const matchesSentId = sentMessageId !== null && (msg.id === sentMessageId || oldId === sentMessageId);
          const matchesFileId = fileId !== null && docFileId === fileId;

          // Fix 1.3: Only resolve on sentMessageId or fileId — no ambiguous filename-only matching
          if (matchesSentId || matchesFileId) {
            console.log('[TdLib sendFile] Message send succeeded!', msg.id);
            if (onProgress) onProgress(1);
            cleanup();
            resolve({ id: msg.id });
          }
        }

        // 4. Track if sending fails
        if (type === 'updatemessagesendfailed' && data?.message) {
          const msg = data.message;
          const oldId = data.old_message_id ?? data.oldMessageId;
          const isOurChat = String(msg.chat_id ?? msg.chatId) === String(targetChatId);
          const doc = msg.content?.document;
          const docFileName = doc?.file_name ?? doc?.fileName;
          const matchesSentId = sentMessageId !== null && (msg.id === sentMessageId || oldId === sentMessageId);
          const matchesDetails = isOurChat && (docFileName === fileName || msg.content?.caption?.text === fileName);

          if (matchesSentId || matchesDetails) {
            cleanup();
            reject(new Error(`TDLib message send failed: ${data.error_message || data.errorMessage || 'Unknown error'}`));
          }
        }
      };

      this.updateListeners.add(updateHandler);

      // Send the document directly using inputFileLocal!
      // TDLib C++ MTProto uploads and sends it in a single native pipeline.
      console.log('[TdLib sendFile] Dispatching sendMessage to targetChatId:', targetChatId, 'path:', localPath);
      TdLib.td_json_client_send({
        '@type': 'sendMessage',
        chat_id: targetChatId,
        input_message_content: {
          '@type': 'inputMessageDocument',
          document: {
            '@type': 'inputFileLocal',
            path: localPath,
          },
          caption: {
            '@type': 'formattedText',
            text: caption ?? fileName,
          },
        },
      }).catch((err) => {
        cleanup();
        reject(new Error(`TDLib sendMessage failed: ${err?.message || err}`));
      });
    });
  }

  /**
   * Fetches the user's Telegram chat list via TDLib.
   * Returns Saved Messages first, then channels/groups/chats.
   */
  public async getChats(limit: number = 50): Promise<TelegramDestination[]> {
    await this.init();

    const me = await this.getMe().catch(() => null);
    const destinations: TelegramDestination[] = [
      {
        id: 'me',
        title: 'Saved Messages (Private Cloud)',
        type: 'saved',
      },
    ];

    try {
      // 1. Ask TDLib to load chats from disk into memory
      await TdLib.loadChats(limit).catch(() => {});

      // 2. Fetch the detailed list of chats via dedicated getChats API
      const rawChats = await TdLib.getChats(limit);
      let chats: any[] = [];
      if (typeof rawChats === 'string' && (rawChats.trim().startsWith('[') || rawChats.trim().startsWith('{'))) {
        try {
          const parsed = JSON.parse(rawChats);
          chats = Array.isArray(parsed) ? parsed : [];
        } catch {
          chats = [];
        }
      } else if (Array.isArray(rawChats)) {
        chats = rawChats;
      }

      for (const chat of chats) {
        if (!chat || !chat.id) continue;
        if (me && chat.id === me.id) continue;

        const chatType = chat.type?.['@type'] || '';
        let type: TelegramDestination['type'] = 'chat';
        if (chatType === 'chatTypeSupergroup') {
          type = chat.type?.is_channel ? 'channel' : 'group';
        } else if (chatType === 'chatTypeBasicGroup') {
          type = 'group';
        }

        destinations.push({
          id: String(chat.id),
          title: chat.title || `Chat ${chat.id}`,
          type,
          username: chat.usernames?.active_usernames?.[0],
        });
      }
    } catch (error) {
      console.error('[TdLib] getChats error:', error);
    }

    return destinations;
  }

  /**
   * Resolves a targetChat string ('me', '@channelname', or numeric ID) to a numeric chat ID.
   */
  public async resolveTargetChatId(targetChat: string = 'me'): Promise<number> {
    await this.init();
    if (targetChat === 'me' || !targetChat) {
      return await this.getSavedMessagesChatId();
    } else if (typeof targetChat === 'string' && targetChat.startsWith('@')) {
      const rawChat = await TdLib.searchPublicChat(targetChat.replace(/^@/, ''));
      const chat = typeof rawChat === 'string' ? JSON.parse(rawChat) : rawChat;
      if (!chat?.id) throw new Error(`Could not resolve channel: ${targetChat}`);
      return chat.id;
    } else {
      const parsed = typeof targetChat === 'string' ? parseInt(targetChat, 10) : targetChat;
      if (isNaN(parsed)) throw new Error(`Invalid chat ID: ${targetChat}`);
      return parsed;
    }
  }

  /**
   * Verifies whether a specific message exists in Telegram cloud.
   * Returns true if message is active, false if deleted or not found.
   */
  public async checkMessageExists(chatId: number, messageId: number): Promise<boolean> {
    await this.init();
    try {
      const result = await TdLib.getMessage(chatId, messageId);
      if (!result) return false;
      const raw = typeof result === 'string' ? result : (result as any).raw;
      if (!raw) return true;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed?.['@type'] === 'error') return false;
      return Boolean(parsed?.id);
    } catch {
      return false;
    }
  }

  /**
   * Verifies a batch of message IDs in a single call or fast bounded parallel pool.
   * Returns a Map<messageId, boolean> of existence status.
   */
  public async checkMessagesBatch(chatId: number, messageIds: number[]): Promise<Map<number, boolean>> {
    await this.init();
    const statusMap = new Map<number, boolean>();
    if (!messageIds || messageIds.length === 0) return statusMap;

    try {
      const rawResult = await TdLib.getMessagesCompat(chatId, messageIds);
      if (rawResult) {
        const parsed = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
        const messages = Array.isArray(parsed) ? parsed : parsed?.messages;
        if (Array.isArray(messages)) {
          for (let i = 0; i < messageIds.length; i++) {
            const mId = messageIds[i];
            const msg = messages[i];
            const exists = Boolean(msg && msg.id && msg['@type'] !== 'error');
            statusMap.set(mId, exists);
          }
          return statusMap;
        }
      }
    } catch {
      // Fallback to bounded parallel checkMessageExists
    }

    // Parallel fallback in chunks of 10
    const chunkSize = 10;
    for (let i = 0; i < messageIds.length; i += chunkSize) {
      const slice = messageIds.slice(i, i + chunkSize);
      await Promise.all(
        slice.map(async (mId) => {
          const exists = await this.checkMessageExists(chatId, mId);
          statusMap.set(mId, exists);
        })
      );
    }

    return statusMap;
  }

  /**
   * Deletes one or more messages permanently from Telegram Cloud.
   * With revoke=true, deletes for all chat participants / servers.
   */
  public async deleteCloudMessages(
    chatId: number,
    messageIds: number[],
    revoke: boolean = true
  ): Promise<boolean> {
    await this.init();
    try {
      return await TdLib.deleteMessages(chatId, messageIds, revoke);
    } catch (err) {
      console.warn('[TdLib] deleteCloudMessages failed:', err);
      return false;
    }
  }

  /**
   * Fetches message history from a chat to discover/restore cloud files.
   */
  public async getChatHistory(
    chatId: number,
    fromMessageId: number = 0,
    limit: number = 50,
    offset: number = 0
  ): Promise<any[]> {
    await this.init();
    try {
      const items = await TdLib.getChatHistory(chatId, fromMessageId, limit, offset);
      if (!Array.isArray(items)) return [];
      return items
        .map((it: any) => {
          if (!it) return null;
          const raw = it.raw_json || it.raw || it;
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        })
        .filter(Boolean);
    } catch (err) {
      console.warn('[TdLib] getChatHistory failed:', err);
      return [];
    }
  }

  /**
   * Alias for logout() — API symmetry with former GramJS disconnect().
   */
  public async disconnect(): Promise<void> {
    return this.logout();
  }

  public async logout(): Promise<void> {
    this.isInitialized = false;
    this.currentAuthState = 'authorizationStateClosed';
    this.myUserId = null;
    try {
      await TdLib.logout();
    } catch {}
  }
}

export const tdLibClient = new TdLibClientService();
