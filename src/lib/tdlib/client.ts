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
  private authResetPromise: Promise<void> | null = null;
  private latestQrLink: string | null = null;
  private qrWaitCleanup: ((cancelled?: boolean) => void) | null = null;
  private qrSessionGen = 0;

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
        if (stateType === 'authorizationStateWaitOtherDeviceConfirmation') {
          if (typeof stateObj?.link === 'string' && stateObj.link.length > 0) {
            this.latestQrLink = stateObj.link;
          }
        } else {
          this.latestQrLink = null;
        }
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

  private async readRawAuthState(): Promise<TdAuthState | null> {
    if (!this.isAvailable()) return null;
    try {
      const raw = await TdLib.getAuthorizationState();
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const state = (parsed?.['@type'] || parsed) as TdAuthState;
      if (state) {
        this.currentAuthState = state;
        return state;
      }
      return null;
    } catch {
      return null;
    }
  }

  private waitForAuthState(targets: TdAuthState[], timeoutMs: number): Promise<TdAuthState | null> {
    if (targets.includes(this.currentAuthState)) {
      return Promise.resolve(this.currentAuthState);
    }

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(null);
      }, timeoutMs);

      const unsub = this.onAuthStateChange((state) => {
        if (settled || !targets.includes(state)) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(state);
      });
    });
  }

  private isPreAuthResetNeeded(state: TdAuthState): boolean {
    return (
      state === 'authorizationStateWaitOtherDeviceConfirmation' ||
      state === 'authorizationStateLoggingOut' ||
      state === 'authorizationStateClosing' ||
      state === 'authorizationStateClosed' ||
      state === 'authorizationStateWaitTdlibParameters' ||
      state === 'unknown'
    );
  }

  /**
   * Cancels any active QR request/confirmation waiter (e.g., when switching tabs or unmounting).
   */
  public cancelQrWait(): void {
    this.qrSessionGen += 1;
    const cleanup = this.qrWaitCleanup;
    this.qrWaitCleanup = null;
    if (cleanup) {
      cleanup(true);
    }
  }

  /**
   * Cleanly exits stuck pre-auth states (such as authorizationStateWaitOtherDeviceConfirmation)
   * and re-initializes TDLib so SetAuthenticationPhoneNumber / RequestQrCodeAuthentication work reliably.
   */
  public async resetAuthToPhone(cancelPendingQr: boolean = true): Promise<void> {
    if (cancelPendingQr) {
      this.cancelQrWait();
    }
    if (this.authResetPromise) {
      return this.authResetPromise;
    }

    this.authResetPromise = (async () => {
      this.latestQrLink = null;
      if (!this.isAvailable()) return;

      const rawState = await this.readRawAuthState();
      if (rawState === 'authorizationStateWaitPhoneNumber') {
        this.isInitialized = true;
        return;
      }

      if (
        rawState &&
        rawState !== 'authorizationStateClosed' &&
        rawState !== 'authorizationStateWaitTdlibParameters'
      ) {
        const isClosingOrReady =
          rawState === 'authorizationStateLoggingOut' ||
          rawState === 'authorizationStateClosing' ||
          rawState === 'authorizationStateReady';

        if (isClosingOrReady) {
          if (rawState === 'authorizationStateReady') {
            await TdLib.logout().catch(() => {});
          }
          const closedState = await this.waitForAuthState(['authorizationStateClosed'], 3500);
          if (!closedState) {
            await TdLib.destroy().catch(() => {});
            await this.waitForAuthState(['authorizationStateClosed'], 2000);
          }
        } else {
          // Pre-auth states (QR confirmation, waitCode, waitPassword, etc.) can be
          // destroyed locally without requiring network logout round-trips.
          await TdLib.destroy().catch(() => {});
          await this.waitForAuthState(['authorizationStateClosed'], 2000);
        }
      }

      this.isInitialized = false;
      this.initPromise = null;
      this.currentAuthState = 'authorizationStateClosed';
      this.myUserId = null;

      await this.init(true);

      // Ensure TDLib has transitioned past parameter setup before returning.
      const settledState = await this.getAuthState();
      if (settledState !== 'authorizationStateWaitPhoneNumber') {
        await this.waitForAuthState(['authorizationStateWaitPhoneNumber'], 3000);
      }
    })().finally(() => {
      this.authResetPromise = null;
    });

    return this.authResetPromise;
  }

  public async loginWithPhone(phoneNumber: string): Promise<string> {
    if (this.authResetPromise) {
      await this.authResetPromise;
    }
    await this.init();

    const currentState = await this.getAuthState();
    if (this.isPreAuthResetNeeded(currentState)) {
      console.log(`[TdLibClientService] Resetting TDLib from ${currentState} before phone login...`);
      await this.resetAuthToPhone();
    }

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
      if (msg.includes('unexpected')) {
        console.warn('[TdLibClientService] TDLib auth state rejected phone login, resetting session...');
        await this.resetAuthToPhone();
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

  private dispatchQrLoginRequest(sessionGen: number): Promise<string> {
    if (sessionGen !== this.qrSessionGen) {
      return Promise.reject(new Error('QR_CANCELLED'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const finish = (cancelled?: boolean, fn?: () => void) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.updateListeners.delete(listener);
        if (this.qrWaitCleanup === onCancel) {
          this.qrWaitCleanup = null;
        }
        if (cancelled) {
          reject(new Error('QR_CANCELLED'));
          return;
        }
        fn?.();
      };

      const onCancel = (cancelled?: boolean) => finish(cancelled);

      timeout = setTimeout(() => {
        finish(false, () => reject(new Error('QR login request timed out. Please try again.')));
      }, 30000);

      const listener: UpdateListener = (type: string, raw: any) => {
        if (settled) return;
        if (type === 'updateAuthorizationState') {
          const state = raw?.authorization_state || raw?.authorizationState;
          const authType = state?.['@type'];
          if (authType === 'authorizationStateWaitOtherDeviceConfirmation' && state?.link) {
            const link = state.link as string;
            this.latestQrLink = link;
            finish(false, () => resolve(link));
          }
        } else if (type === 'error') {
          const errMsg = String(raw?.message || '');
          if (errMsg.toLowerCase().includes('unexpected') || errMsg.toLowerCase().includes('qr')) {
            finish(false, () => reject(new Error(errMsg || 'Failed to start QR login.')));
          }
        }
      };

      this.qrWaitCleanup = onCancel;
      this.updateListeners.add(listener);

      TdLib.td_json_client_send({
        '@type': 'requestQrCodeAuthentication',
        other_user_ids: [],
      }).catch((err: any) => {
        finish(false, () => reject(err instanceof Error ? err : new Error(String(err))));
      });
    });
  }

  public async requestQrLogin(forceRefresh: boolean = false): Promise<string> {
    this.cancelQrWait();
    const myGen = this.qrSessionGen;

    if (this.authResetPromise) {
      await this.authResetPromise;
      if (myGen !== this.qrSessionGen) {
        throw new Error('QR_CANCELLED');
      }
    }
    await this.init();
    if (myGen !== this.qrSessionGen) {
      throw new Error('QR_CANCELLED');
    }

    const currentState = await this.getAuthState();
    if (myGen !== this.qrSessionGen) {
      throw new Error('QR_CANCELLED');
    }

    if (!forceRefresh && currentState === 'authorizationStateWaitOtherDeviceConfirmation' && this.latestQrLink) {
      return this.latestQrLink;
    }

    if (this.isPreAuthResetNeeded(currentState)) {
      await this.resetAuthToPhone(false);
      if (myGen !== this.qrSessionGen) {
        throw new Error('QR_CANCELLED');
      }
    }

    try {
      return await this.dispatchQrLoginRequest(myGen);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg === 'QR_CANCELLED' || myGen !== this.qrSessionGen) {
        throw new Error('QR_CANCELLED');
      }
      if (msg.includes('unexpected') || msg.includes('CLIENT_NOT_INITIALIZED')) {
        console.warn('[TdLibClientService] Resetting TDLib before retrying QR request...');
        await this.resetAuthToPhone(false);
        return await this.dispatchQrLoginRequest(myGen);
      }
      throw err;
    }
  }

  public async listenForQrConfirmation(
    optionsOrTimeout:
      | number
      | {
          timeoutMs?: number;
          onLinkUpdate?: (link: string) => void;
        } = 90000
  ): Promise<void> {
    this.cancelQrWait();

    const timeoutMs =
      typeof optionsOrTimeout === 'number' ? optionsOrTimeout : (optionsOrTimeout?.timeoutMs ?? 90000);
    const onLinkUpdate =
      typeof optionsOrTimeout === 'number' ? undefined : optionsOrTimeout?.onLinkUpdate;

    if (this.currentAuthState === 'authorizationStateReady') {
      return;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (cancelled?: boolean) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.updateListeners.delete(listener);
        if (this.qrWaitCleanup === cleanup) {
          this.qrWaitCleanup = null;
        }
        if (cancelled) {
          reject(new Error('QR_CANCELLED'));
        }
      };

      const armTimeout = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(async () => {
          if (settled) return;
          // App may have been backgrounded while user confirmed in Telegram; verify actual state before failing.
          const latestState =
            this.currentAuthState === 'authorizationStateReady' ||
            this.currentAuthState === 'authorizationStateWaitPassword'
              ? this.currentAuthState
              : await this.readRawAuthState();
          if (settled) return;
          if (latestState === 'authorizationStateReady') {
            cleanup(false);
            resolve();
            return;
          }
          if (latestState === 'authorizationStateWaitPassword') {
            cleanup(false);
            reject(new Error('2FA_REQUIRED'));
            return;
          }
          cleanup(false);
          reject(new Error('QR scan expired. Tap to refresh.'));
        }, timeoutMs);
      };

      const listener: UpdateListener = (type: string, raw: any) => {
        if (settled || type !== 'updateAuthorizationState') return;
        const state = raw?.authorization_state || raw?.authorizationState;
        const authType = state?.['@type'];
        if (authType === 'authorizationStateReady') {
          cleanup(false);
          resolve();
        } else if (authType === 'authorizationStateWaitPassword') {
          cleanup(false);
          reject(new Error('2FA_REQUIRED'));
        } else if (authType === 'authorizationStateWaitPhoneNumber') {
          cleanup(false);
          reject(new Error('QR code was cancelled or expired.'));
        } else if (authType === 'authorizationStateWaitOtherDeviceConfirmation' && typeof state?.link === 'string') {
          this.latestQrLink = state.link;
          // TDLib refreshed the QR token automatically; extend the idle timeout.
          armTimeout();
          onLinkUpdate?.(state.link);
        }
      };

      this.qrWaitCleanup = cleanup;
      this.updateListeners.add(listener);
      armTimeout();
    });
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
    caption?: string,
    abortSignal?: AbortSignal
  ): Promise<{ id: number }> {
    if (abortSignal?.aborted) {
      throw new Error('UPLOAD_PAUSED');
    }
    await this.init();

    // 1. Resolve to native absolute filesystem path, preserving real filename & extension
    const { path: localPath, isTemp } = await resolveToLocalPath(uri, fileName);

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

      const handleAbort = () => {
        if (isDone) return;
        console.log('[TdLib sendFile] Aborting upload due to pause signal', { fileId, sentMessageId });
        if (sentMessageId !== null) {
          TdLib.deleteMessages(targetChatId, [sentMessageId], true).catch(() => {});
        }
        if (fileId !== null) {
          TdLib.td_json_client_send({
            '@type': 'cancelPreliminaryUploadFile',
            file_id: fileId,
          }).catch(() => {});
        }
        cleanup();
        reject(new Error('UPLOAD_PAUSED'));
      };

      const cleanup = async () => {
        isDone = true;
        if (abortSignal) {
          abortSignal.removeEventListener('abort', handleAbort);
        }
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

      if (abortSignal) {
        if (abortSignal.aborted) {
          handleAbort();
          return;
        }
        abortSignal.addEventListener('abort', handleAbort, { once: true });
      }

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
   * Sends a raw TDLib function request via td_json_client_send and awaits a matching response event.
   */
  private sendTdRequest<T = any>(
    request: Record<string, any>,
    match: (type: string, data: any) => boolean,
    timeoutMs: number = 3500
  ): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      let settled = false;
      let handler: ((type: string, data: any) => void) | null = null;

      const finish = (value: T | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (handler) {
          this.updateListeners.delete(handler);
          handler = null;
        }
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      handler = (type: string, data: any) => {
        const resolvedType = type || data?.['@type'] || '';
        if (match(resolvedType, data)) {
          finish(data as T);
        }
      };

      this.updateListeners.add(handler);

      TdLib.td_json_client_send(request).catch(() => {
        finish(null);
      });
    });
  }

  private async fetchChatById(chatId: number): Promise<any | null> {
    return await this.sendTdRequest<any>(
      { '@type': 'getChat', chat_id: chatId },
      (type, data) =>
        (type === 'chat' || data?.['@type'] === 'chat') &&
        Number(data?.id) === Number(chatId),
      3500
    );
  }

  private async buildDestinationFromChat(
    chat: any,
    createdChatIds: Set<number>
  ): Promise<TelegramDestination | null> {
    if (!chat || !chat.id) return null;

    const chatIdNum = Number(chat.id);
    const chatType = chat.type?.['@type'] || '';
    const isCreated = createdChatIds.has(chatIdNum);
    let type: TelegramDestination['type'] = 'chat';
    let isCreator = isCreated;
    let isAdmin = isCreated;
    let canPost = isCreated;

    if (chatType === 'chatTypeSupergroup') {
      const supergroupId = Number(chat.type?.supergroup_id);
      let isChannel = Boolean(chat.type?.is_channel);

      if (!Number.isNaN(supergroupId) && supergroupId > 0) {
        const sg = await this.sendTdRequest<any>(
          { '@type': 'getSupergroup', supergroup_id: supergroupId },
          (t, d) =>
            (t === 'supergroup' || d?.['@type'] === 'supergroup') &&
            Number(d?.id) === supergroupId,
          2500
        );
        if (sg) {
          if (typeof sg.is_channel === 'boolean') {
            isChannel = sg.is_channel;
          }
          const statusType = sg.status?.['@type'];
          if (statusType === 'chatMemberStatusCreator' && sg.status?.is_member !== false) {
            isCreator = true;
            isAdmin = true;
            canPost = true;
          } else if (statusType === 'chatMemberStatusAdministrator') {
            isAdmin = true;
            // Default user can post/select channels/groups where they are an administrator
            canPost = isChannel
              ? sg.status?.rights?.can_post_messages !== false
              : true;
          } else {
            isCreator = isCreated;
            isAdmin = isCreated;
            canPost = isCreated
              ? true
              : !isChannel && !sg.is_broadcast_group && chat.permissions?.can_send_basic_messages !== false;
          }
        }
      }

      type = isChannel ? 'channel' : 'group';
    } else if (chatType === 'chatTypeBasicGroup') {
      const basicGroupId = Number(chat.type?.basic_group_id);
      type = 'group';

      if (!Number.isNaN(basicGroupId) && basicGroupId > 0) {
        const bg = await this.sendTdRequest<any>(
          { '@type': 'getBasicGroup', basic_group_id: basicGroupId },
          (t, d) =>
            (t === 'basicGroup' || d?.['@type'] === 'basicGroup') &&
            Number(d?.id) === basicGroupId,
          2500
        );
        if (bg) {
          // Skip basic groups that have already migrated to a supergroup
          if (bg.upgraded_to_supergroup_id && Number(bg.upgraded_to_supergroup_id) !== 0) {
            return null;
          }
          const statusType = bg.status?.['@type'];
          if (statusType === 'chatMemberStatusCreator' && bg.status?.is_member !== false) {
            isCreator = true;
            isAdmin = true;
            canPost = true;
          } else if (statusType === 'chatMemberStatusAdministrator') {
            isAdmin = true;
            canPost = true;
          } else {
            canPost = chat.permissions?.can_send_basic_messages !== false;
          }
        }
      }
    } else {
      type = 'chat';
      canPost = true;
    }

    return {
      id: String(chat.id),
      title: chat.title || `Chat ${chat.id}`,
      type,
      username: chat.usernames?.active_usernames?.[0],
      isCreator,
      isAdmin,
      canPost,
      memberRole: isCreator ? 'owner' : isAdmin ? 'admin' : 'member',
    };
  }

  /**
   * Fetches the user's Telegram chat list via TDLib.
   * Returns Saved Messages first, then channels/groups/chats enriched with admin/owner privileges.
   */
  public async getChats(limit: number = 200): Promise<TelegramDestination[]> {
    await this.init();

    const me = await this.getMe().catch(() => null);
    const savedDest: TelegramDestination = {
      id: 'me',
      title: 'Saved Messages (Private Cloud)',
      type: 'saved',
      isCreator: true,
      isAdmin: true,
      canPost: true,
      memberRole: 'owner',
    };

    const collected: TelegramDestination[] = [];
    const chatMap = new Map<number, any>();
    const createdChatIds = new Set<number>();

    try {
      // 1. Load main chat list chunks into TDLib memory/cache
      for (let i = 0; i < 6; i++) {
        const msg = await TdLib.loadChats(100).catch(() => null);
        if (typeof msg === 'string' && msg.toLowerCase().includes('no more chats')) {
          break;
        }
      }

      // 2. Also load archived chats so created/archived backup channels are discovered
      await TdLib.td_json_client_send({
        '@type': 'loadChats',
        chat_list: { '@type': 'chatListArchive' },
        limit: 100,
      }).catch(() => {});

      // 3. Fetch detailed main chat objects via dedicated getChats API
      const rawChats = await TdLib.getChats(limit);
      let mainChats: any[] = [];
      if (typeof rawChats === 'string' && (rawChats.trim().startsWith('[') || rawChats.trim().startsWith('{'))) {
        try {
          const parsed = JSON.parse(rawChats);
          mainChats = Array.isArray(parsed) ? parsed : [];
        } catch {
          mainChats = [];
        }
      } else if (Array.isArray(rawChats)) {
        mainChats = rawChats;
      }

      for (const chat of mainChats) {
        if (chat?.id) {
          chatMap.set(Number(chat.id), chat);
        }
      }

      // 4. Fetch archived chat IDs so muted/archived channels still appear
      const archiveChatsRes = await this.sendTdRequest<{ chat_ids?: number[] }>(
        { '@type': 'getChats', chat_list: { '@type': 'chatListArchive' }, limit: 100 },
        (t, d) => t === 'chats' || d?.['@type'] === 'chats',
        2500
      );
      const archiveIds: number[] = Array.isArray(archiveChatsRes?.chat_ids) ? archiveChatsRes.chat_ids : [];

      // 5. Explicitly fetch all public channels & supergroups created by this account
      for (const publicType of ['publicChatTypeHasUsername', 'publicChatTypeIsLocationBased']) {
        const createdRes = await this.sendTdRequest<{ chat_ids?: number[] }>(
          { '@type': 'getCreatedPublicChats', type: { '@type': publicType } },
          (t, d) => t === 'chats' || d?.['@type'] === 'chats',
          3500
        );
        if (Array.isArray(createdRes?.chat_ids)) {
          for (const cid of createdRes.chat_ids) {
            createdChatIds.add(Number(cid));
          }
        }
      }

      const missingIds = new Set<number>([...archiveIds, ...createdChatIds]);
      for (const cid of missingIds) {
        if (!chatMap.has(cid)) {
          const chatObj = await this.fetchChatById(cid);
          if (chatObj?.id) {
            chatMap.set(Number(chatObj.id), chatObj);
          }
        }
      }

      // 6. Enrich each chat with supergroup/basicGroup creator & admin rights
      for (const chat of chatMap.values()) {
        const chatIdNum = Number(chat?.id);
        if (!chat || Number.isNaN(chatIdNum)) continue;
        if (me && chatIdNum === Number(me.id)) continue;

        const dest = await this.buildDestinationFromChat(chat, createdChatIds);
        if (dest) {
          collected.push(dest);
        }
      }

      // Prioritize owner/admin channels & groups first, then others alphabetically
      collected.sort((a, b) => {
        const rank = (d: TelegramDestination) => {
          if (d.isCreator && (d.type === 'channel' || d.type === 'group')) return 0;
          if (d.isAdmin && (d.type === 'channel' || d.type === 'group')) return 1;
          if (d.type === 'channel' || d.type === 'group') return 2;
          return 3;
        };
        const rDiff = rank(a) - rank(b);
        if (rDiff !== 0) return rDiff;
        return a.title.localeCompare(b.title);
      });
    } catch (error) {
      console.error('[TdLib] getChats error:', error);
    }

    return [savedDest, ...collected];
  }

  /**
   * Resolves a manual destination input ('me', '@channelname', or numeric chat ID)
   * into a verified TelegramDestination with resolved title and admin/owner status.
   */
  public async resolveDestinationInput(input: string): Promise<TelegramDestination> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Destination cannot be empty.');
    }
    if (trimmed === 'me') {
      return {
        id: 'me',
        title: 'Saved Messages (Private Cloud)',
        type: 'saved',
        isCreator: true,
        isAdmin: true,
        canPost: true,
        memberRole: 'owner',
      };
    }

    const numericChatId = await this.resolveTargetChatId(trimmed);
    const chatObj = await this.fetchChatById(numericChatId);
    if (chatObj) {
      const dest = await this.buildDestinationFromChat(chatObj, new Set<number>());
      if (dest) return dest;
    }

    return {
      id: String(numericChatId),
      title: trimmed.startsWith('@') ? trimmed : `Chat ${numericChatId}`,
      type: 'channel',
      username: trimmed.startsWith('@') ? trimmed.slice(1) : undefined,
    };
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
      const numericChatId = Number(chatId);
      const numericMsgId = Number(messageId);
      if (!Number.isFinite(numericChatId) || !Number.isFinite(numericMsgId)) {
        return false;
      }
      const result = await TdLib.getMessage(numericChatId, numericMsgId);
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
   * Downloads a file from Telegram by chatId and messageId.
   * Reports progress (0 to 1) and returns the local file path on completion.
   */
  public async downloadMessageFile(
    chatId: number,
    messageId: number,
    onProgress?: (progress: number, downloadedBytes: number, totalBytes: number) => void
  ): Promise<string> {
    await this.init();

    const numericChatId = Number(chatId);
    const numericMsgId = Number(messageId);
    if (!Number.isFinite(numericChatId) || !Number.isFinite(numericMsgId)) {
      throw new Error(`Invalid chatId (${String(chatId)}) or messageId (${String(messageId)}) passed to downloadMessageFile`);
    }

    // 1. Fetch message from TDLib
    const result = await TdLib.getMessage(numericChatId, numericMsgId);
    if (!result) {
      throw new Error(`Message ${messageId} not found in chat ${chatId}`);
    }

    const raw = typeof result === 'string' ? result : (result as any).raw || result;
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!msg || msg['@type'] === 'error') {
      const errMsg = msg?.message || `Message ${messageId} not found in chat ${chatId}`;
      throw new Error(`Failed to fetch cloud message: ${errMsg}`);
    }

    // 2. Extract fileId from content
    let fileId: number | null = null;
    let expectedSize = 0;
    let localPath: string | null = null;
    const content = msg.content;

    if (content) {
      const doc = content.document?.document || content.document;
      const photo = content.photo?.sizes?.length ? content.photo.sizes[content.photo.sizes.length - 1]?.photo : null;
      const video = content.video?.video || content.video;
      const audio = content.audio?.audio || content.audio;
      const voice = content.voice_note?.voice || content.voice_note;

      const targetFile = doc || photo || video || audio || voice;
      if (targetFile) {
        fileId = targetFile.id ?? null;
        expectedSize = targetFile.size || targetFile.expected_size || 0;
        if (targetFile.local?.is_downloading_completed && targetFile.local?.path) {
          localPath = targetFile.local.path;
        }
      }
    }

    if (!fileId) {
      throw new Error(`Message ${messageId} contains no downloadable file content.`);
    }

    // If already downloaded and file exists
    if (localPath) {
      const exists = await LegacyFileSystem.getInfoAsync(localPath).catch(() => ({ exists: false }));
      if (exists.exists) {
        if (onProgress) onProgress(1, expectedSize, expectedSize);
        return localPath;
      }
    }

    // 3. Request download & await completion via updateListener
    return new Promise<string>((resolve, reject) => {
      let completed = false;
      let updateHandler: any = null;

      const cleanup = () => {
        if (updateHandler) {
          this.updateListeners.delete(updateHandler);
          updateHandler = null;
        }
      };

      const timeoutId = setTimeout(() => {
        if (!completed) {
          cleanup();
          reject(new Error(`Download timed out for message ${messageId} (fileId: ${fileId})`));
        }
      }, 10 * 60 * 1000); // 10 minutes timeout for large files

      updateHandler = (type: string, data: any) => {
        const lowerType = (type || data?.['@type'] || '').toLowerCase();

        if (lowerType === 'error' && data) {
          completed = true;
          clearTimeout(timeoutId);
          cleanup();
          reject(new Error(data.message || 'TDLib download error'));
          return;
        }

        if (lowerType === 'updatefile' && data?.file) {
          const f = data.file;
          if (f.id === fileId) {
            const downloaded = f.local?.downloaded_size ?? (f.local as any)?.downloadedSize ?? 0;
            const total = f.expected_size || f.size || expectedSize || 1;
            const progress = Math.min(1, Math.max(0, downloaded / total));

            if (onProgress) {
              onProgress(progress, downloaded, total);
            }

            const isCompleted = f.local?.is_downloading_completed ?? (f.local as any)?.isDownloadingCompleted;
            if (isCompleted && f.local?.path) {
              completed = true;
              clearTimeout(timeoutId);
              cleanup();
              resolve(f.local.path);
            }
          }
        }
      };

      this.updateListeners.add(updateHandler);

      // Invoke downloadFile in TDLib
      TdLib.td_json_client_send({
        '@type': 'downloadFile',
        file_id: fileId,
        priority: 32,
        offset: 0,
        limit: 0,
        synchronous: false,
      }).catch((err: any) => {
        clearTimeout(timeoutId);
        cleanup();
        reject(new Error(`Failed to initiate TDLib downloadFile: ${err?.message || err}`));
      });
    });
  }

  /**
   * Downloads a small message thumbnail if present.
   */
  public async downloadMessageThumbnail(
    chatId: number,
    messageId: number
  ): Promise<string | null> {
    try {
      await this.init();
      const numericChatId = Number(chatId);
      const numericMsgId = Number(messageId);
      if (!Number.isFinite(numericChatId) || !Number.isFinite(numericMsgId)) {
        return null;
      }
      const result = await TdLib.getMessage(numericChatId, numericMsgId);
      if (!result) return null;

      const raw = typeof result === 'string' ? result : (result as any).raw || result;
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;

      const thumb =
        msg?.content?.document?.thumbnail?.file ||
        msg?.content?.video?.thumbnail?.file ||
        msg?.content?.photo?.sizes?.[0]?.photo;

      if (!thumb?.id) return null;
      if (thumb.local?.is_downloading_completed && thumb.local?.path) {
        const exists = await LegacyFileSystem.getInfoAsync(thumb.local.path).catch(() => ({ exists: false }));
        if (exists.exists) return thumb.local.path;
      }

      return new Promise<string | null>((resolve) => {
        let updateHandler: any = null;
        const timeoutId = setTimeout(() => {
          if (updateHandler) this.updateListeners.delete(updateHandler);
          resolve(null);
        }, 15000); // 15s timeout for thumbnails

        updateHandler = (type: string, data: any) => {
          const lowerType = (type || data?.['@type'] || '').toLowerCase();
          if (lowerType === 'updatefile' && data?.file?.id === thumb.id) {
            if (data.file.local?.is_downloading_completed && data.file.local?.path) {
              clearTimeout(timeoutId);
              if (updateHandler) this.updateListeners.delete(updateHandler);
              resolve(data.file.local.path);
            }
          }
        };

        this.updateListeners.add(updateHandler);

        TdLib.td_json_client_send({
          '@type': 'downloadFile',
          file_id: thumb.id,
          priority: 16,
          offset: 0,
          limit: 0,
          synchronous: false,
        }).catch(() => {
          clearTimeout(timeoutId);
          if (updateHandler) this.updateListeners.delete(updateHandler);
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  /**
   * Alias for logout() — API symmetry with former GramJS disconnect().
   */
  public async disconnect(): Promise<void> {
    return this.logout();
  }

  public async logout(): Promise<void> {
    this.cancelQrWait();
    this.latestQrLink = null;
    this.initPromise = null;
    this.isInitialized = false;
    this.myUserId = null;
    try {
      const state = await this.readRawAuthState();
      if (state && state !== 'authorizationStateClosed') {
        await TdLib.logout().catch(() => {});
        await this.waitForAuthState(['authorizationStateClosed'], 2500);
      }
    } catch {}
    this.currentAuthState = 'authorizationStateClosed';
  }
}

export const tdLibClient = new TdLibClientService();
