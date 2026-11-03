import 'react-native-get-random-values';
import '@/shims/polyfills';
import { Buffer } from 'buffer';
import bigInt from 'big-integer';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/StringSession';
import { PromisedWebSockets } from 'telegram/extensions';
import { ConnectionTCPObfuscated } from 'telegram/network';
import { computeCheck } from 'telegram/Password';
import { CustomFile } from 'telegram/client/uploads';
import * as SecureStoreLib from '../storage/secure';
import { readFileToBuffer } from '../storage/fileHelper';

// Official Telegram public desktop client credentials as default fallback
export const DEFAULT_API_ID = 2040;
export const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

export interface TelegramDCEndpoint {
  id: number;
  ipAddress: string;
  port: number;
}

export const TELEGRAM_DC_ENDPOINTS: Record<number, TelegramDCEndpoint> = {
  1: { id: 1, ipAddress: 'pluto.web.telegram.org', port: 443 },
  2: { id: 2, ipAddress: 'venus.web.telegram.org', port: 443 },
  3: { id: 3, ipAddress: 'aurora.web.telegram.org', port: 443 },
  4: { id: 4, ipAddress: 'vesta.web.telegram.org', port: 443 },
  5: { id: 5, ipAddress: 'flora.web.telegram.org', port: 443 },
};

/**
 * Predicts the user's primary Telegram Data Center based on phone country code.
 * Connecting directly to the home DC eliminates the PHONE_MIGRATE round-trip and
 * prevents running the expensive 2048-bit Diffie-Hellman handshake twice.
 */
export function getOptimalDCForPhone(phoneNumber?: string): TelegramDCEndpoint {
  if (!phoneNumber) return TELEGRAM_DC_ENDPOINTS[4];
  const clean = phoneNumber.replace(/[^\d+]/g, '');

  // DC 5: India, Singapore, Southeast Asia, East Asia, South Asia
  if (
    clean.startsWith('+91') || // India
    clean.startsWith('+65') || // Singapore
    clean.startsWith('+60') || // Malaysia
    clean.startsWith('+62') || // Indonesia
    clean.startsWith('+84') || // Vietnam
    clean.startsWith('+66') || // Thailand
    clean.startsWith('+63') || // Philippines
    clean.startsWith('+81') || // Japan
    clean.startsWith('+82') || // South Korea
    clean.startsWith('+86') || // China
    clean.startsWith('+880') || // Bangladesh
    clean.startsWith('+92') || // Pakistan
    clean.startsWith('+94') || // Sri Lanka
    clean.startsWith('+977')   // Nepal
  ) {
    return TELEGRAM_DC_ENDPOINTS[5];
  }

  // DC 1: North America & South America
  if (
    clean.startsWith('+1') ||  // USA, Canada
    clean.startsWith('+52') || // Mexico
    clean.startsWith('+55') || // Brazil
    clean.startsWith('+54') || // Argentina
    clean.startsWith('+56') || // Chile
    clean.startsWith('+57') || // Colombia
    clean.startsWith('+58') || // Venezuela
    clean.startsWith('+51')    // Peru
  ) {
    return TELEGRAM_DC_ENDPOINTS[1];
  }

  // DC 2: Russia, CIS, Eastern Europe
  if (
    clean.startsWith('+7') ||   // Russia, Kazakhstan
    clean.startsWith('+380') || // Ukraine
    clean.startsWith('+375')    // Belarus
  ) {
    return TELEGRAM_DC_ENDPOINTS[2];
  }

  // DC 4: Western/Central Europe, UK, Middle East, Africa & fallback default
  return TELEGRAM_DC_ENDPOINTS[4];
}

let client: any = null;
let apiId: number = DEFAULT_API_ID;
let apiHash: string = DEFAULT_API_HASH;
let cachedLoginStatus: { value: boolean; timestamp: number } | null = null;
const LOGIN_CACHE_TTL = 30000;

export { client };

export async function initializeClient(targetPhone?: string): Promise<any> {
  // If client already exists, verify if targetPhone requires a different DC (for initial auth)
  if (client) {
    if (targetPhone && !client.session?.authKey?.key) {
      const optimalDC = getOptimalDCForPhone(targetPhone);
      if (client.session && client.session.dcId !== optimalDC.id) {
        try {
          await client.disconnect();
        } catch {}
        client = null;
      } else {
        return client;
      }
    } else {
      return client;
    }
  }
  
  const creds = await SecureStoreLib.getApiCredentials();
  if (creds.apiId && creds.apiHash) {
    apiId = parseInt(creds.apiId, 10);
    apiHash = creds.apiHash;
  } else {
    apiId = DEFAULT_API_ID;
    apiHash = DEFAULT_API_HASH;
  }
  
  const sessionStr = await SecureStoreLib.getSession();
  const session = new StringSession(sessionStr || '');
  if (!session.serverAddress) {
    let chosenDC = TELEGRAM_DC_ENDPOINTS[4];
    if (targetPhone) {
      chosenDC = getOptimalDCForPhone(targetPhone);
    } else {
      const savedPhone = await SecureStoreLib.getPhone();
      if (savedPhone) {
        chosenDC = getOptimalDCForPhone(savedPhone);
      }
    }
    session.setDC(chosenDC.id, chosenDC.ipAddress, chosenDC.port);
  }
  
  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 1,
    useWSS: true,
    networkSocket: PromisedWebSockets,
    connection: ConnectionTCPObfuscated,
    deviceModel: 'Android',
    systemVersion: '14',
    appVersion: '11.0.0',
    langCode: 'en',
    systemLangCode: 'en',
    timeout: 10,
    retryDelay: 500,
    maxConcurrentDownloads: 1,
  });
  
  return client;
}

export async function startAuth(phoneNumber: string): Promise<{ phoneCodeHash: string }> {
  // Force reset any existing client before starting fresh auth
  if (client) {
    try {
      await client.disconnect();
    } catch {}
    client = null;
  }
  cachedLoginStatus = null;
  (globalThis as any).__nimo_cached_login = null;

  const c = await initializeClient(phoneNumber);
  if (!c) throw new Error('Failed to initialize client');
  
  try {
    await c.connect();
  } catch (e) {
    console.log('[TG] Connect error, retrying...');
    try { await (c as any).disconnect(); } catch {}
    client = null;
    const c2 = await initializeClient(phoneNumber);
    await c2.connect();
    const result: any = await c2.invoke(
      new Api.auth.SendCode({
        phoneNumber,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    );
    console.log('[TG] SendCode result:', result?.phoneCodeHash ? 'OK' : JSON.stringify(result));
    try {
      const sessionStr = c2.session.save();
      if (sessionStr) {
        await SecureStoreLib.saveSession(sessionStr);
      }
      await SecureStoreLib.savePhone(phoneNumber);
    } catch (err) {
      console.warn('Could not save preliminary session:', err);
    }
    return { phoneCodeHash: result.phoneCodeHash };
  }
  
  console.log('[TG] Connected, sending code...');
  const result: any = await c.invoke(
    new Api.auth.SendCode({
      phoneNumber,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({}),
    })
  );
  console.log('[TG] SendCode result:', result?.phoneCodeHash ? 'OK' : JSON.stringify(result));
  
  // Immediately persist session so signIn reuses this exact DC & key without re-handshake
  try {
    const sessionStr = c.session.save();
    if (sessionStr) {
      await SecureStoreLib.saveSession(sessionStr);
    }
    await SecureStoreLib.savePhone(phoneNumber);
  } catch (err) {
    console.warn('Could not save preliminary session:', err);
  }
  
  return { phoneCodeHash: result.phoneCodeHash };
}

export async function signIn(phoneNumber: string, code: string, phoneCodeHash: string): Promise<boolean> {
  // Force reset and reinitialize to use saved session from startAuth
  if (client) {
    try {
      await client.disconnect();
    } catch {}
    client = null;
  }
  cachedLoginStatus = null;
  (globalThis as any).__nimo_cached_login = null;
  
  const c = await initializeClient(phoneNumber);
  if (!c) throw new Error('Failed to initialize client');
  
  try {
    await c.connect();
    console.log('[TG] Calling SignIn...');
    await c.invoke(
      new Api.auth.SignIn({
        phoneNumber,
        phoneCodeHash,
        phoneCode: code,
      })
    );
    console.log('[TG] SignIn OK');
    
    const sessionStr = c.session.save();
    await SecureStoreLib.saveSession(sessionStr);
    await SecureStoreLib.savePhone(phoneNumber);
    cachedLoginStatus = { value: true, timestamp: Date.now() };
    (globalThis as any).__nimo_cached_login = { value: true, timestamp: Date.now() };
    
    return true;
  } catch (error: any) {
    console.log('[TG] SignIn error:', error?.errorMessage || error?.message);
    if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      throw new Error('2FA_PASSWORD_REQUIRED');
    }
    throw error;
  }
}

export async function signInWithPassword(password: string): Promise<boolean> {
  const c = await initializeClient();
  if (!c) throw new Error('Failed to initialize client');
  
  try {
    if (!(c as any).isConnected || !(c as any).isConnected()) {
      await c.connect().catch(() => {});
    }
  } catch (e) {
    // ignore
  }
  
  console.log('[TG2FA] Getting password info...');
  const passwordSrp: any = await c.invoke(new Api.account.GetPassword());
  console.log('[TG2FA] Computing check...');
  const passwordSrpCheck = await computeCheck(passwordSrp, password);
  console.log('[TG2FA] Checking password...');
  await c.invoke(
    new Api.auth.CheckPassword({
      password: passwordSrpCheck,
    })
  );
  console.log('[TG2FA] Success');
  
  const sessionStr = c.session.save();
  await SecureStoreLib.saveSession(sessionStr);
  cachedLoginStatus = { value: true, timestamp: Date.now() };
  (globalThis as any).__nimo_cached_login = { value: true, timestamp: Date.now() };
  return true;
}

export async function isLoggedIn(): Promise<boolean> {
  try {
    if ((globalThis as any).__nimo_cached_login) {
      const c = (globalThis as any).__nimo_cached_login;
      if (Date.now() - c.timestamp < LOGIN_CACHE_TTL) {
        return c.value;
      }
    }
    if (cachedLoginStatus && Date.now() - cachedLoginStatus.timestamp < LOGIN_CACHE_TTL) {
      return cachedLoginStatus.value;
    }
    const session = await SecureStoreLib.getSession();
    if (!session) {
      cachedLoginStatus = { value: false, timestamp: Date.now() };
      return false;
    }
    const c = await initializeClient();
    if (!c) {
      cachedLoginStatus = { value: false, timestamp: Date.now() };
      return false;
    }
    try {
      await c.connect();
    } catch {}
    const me = await c.getMe();
    const result = !!me;
    cachedLoginStatus = { value: result, timestamp: Date.now() };
    return result;
  } catch {
    cachedLoginStatus = { value: false, timestamp: Date.now() };
    return false;
  }
}

export async function getMe() {
  const c = await initializeClient();
  if (!c) throw new Error('Not initialized');
  await c.connect();
  return await c.getMe();
}

export interface TelegramDestination {
  id: string;
  title: string;
  type: 'saved' | 'channel' | 'group' | 'chat';
  username?: string;
}

export async function getTelegramDialogs(): Promise<TelegramDestination[]> {
  const c = await initializeClient();
  if (!c) throw new Error('Not initialized');
  await c.connect();

  const destinations: TelegramDestination[] = [
    {
      id: 'me',
      title: 'Saved Messages (Private Cloud)',
      type: 'saved',
    },
  ];

  try {
    const dialogs = await c.getDialogs({ limit: 50 });
    for (const d of dialogs) {
      if (!d.id) continue;
      const idStr = d.id.toString();

      let type: TelegramDestination['type'] = 'chat';
      if (d.isChannel) {
        type = 'channel';
      } else if (d.isGroup) {
        type = 'group';
      } else if (d.isUser) {
        const entity: any = d.entity;
        if (entity?.isSelf) continue;
        type = 'chat';
      }

      const title = d.title || d.name || `Chat ${idStr}`;
      const username = (d.entity as any)?.username;

      destinations.push({
        id: idStr,
        title,
        type,
        username,
      });
    }
  } catch (error) {
    console.error('Error fetching Telegram dialogs:', error);
  }

  return destinations;
}

export async function sendFile(
  fileOrUri: any,
  captionOrFileName?: string,
  chatId?: any,
  onProgress?: (progress: number) => void
): Promise<any> {
  const c = await initializeClient();
  if (!c) throw new Error('Not initialized');
  await c.connect();

  const authorized = await c.isUserAuthorized().catch(() => false);
  if (!authorized) {
    throw new Error('Not logged into Telegram. Please connect your account first.');
  }
  
  let fileToUpload: any = fileOrUri;
  let caption = '';

  if (typeof fileOrUri === 'string') {
    const uri = fileOrUri;
    const name = captionOrFileName || uri.split('/').pop() || 'file.bin';
    
    // Read file via universal reader supporting file:// and content://
    const buffer = await readFileToBuffer(uri);
    fileToUpload = new CustomFile(name, buffer.length, '', buffer);
  } else if (Buffer.isBuffer(fileOrUri)) {
    const name = captionOrFileName || 'file.bin';
    fileToUpload = new CustomFile(name, fileOrUri.length, '', fileOrUri);
  } else if (typeof captionOrFileName === 'string') {
    caption = captionOrFileName;
  }
  
  let target: any = chatId || 'me';
  if (target !== 'me') {
    if (typeof target === 'string' && /^-?\d+$/.test(target)) {
      try {
        target = bigInt(target);
      } catch {
        // keep as string
      }
    }
    try {
      const entity = await c.getEntity(target);
      if (entity) {
        target = entity;
      }
    } catch {
      // keep target as is if getEntity fails
    }
  }

  const result = await c.sendFile(target, {
    file: fileToUpload,
    caption: caption,
    forceDocument: false,
    workers: 8,
    progressCallback: (progress: number) => {
      if (onProgress) onProgress(progress);
    },
  });
  
  return result;
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
  }
}
