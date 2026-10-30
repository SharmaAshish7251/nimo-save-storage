import '@/shims/polyfills';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/StringSession';
import { PromisedWebSockets } from 'telegram/extensions';
import { ConnectionTCPObfuscated } from 'telegram/network';
import { computeCheck } from 'telegram/Password';
import * as SecureStoreLib from '../storage/secure';

// Official Telegram public desktop client credentials as default fallback
export const DEFAULT_API_ID = 2040;
export const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

let client: any = null;
let apiId: number = DEFAULT_API_ID;
let apiHash: string = DEFAULT_API_HASH;

export async function initializeClient(): Promise<any> {
  if (client) return client;
  
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
    session.setDC(4, 'vesta.web.telegram.org', 443);
  }
  
  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
    networkSocket: PromisedWebSockets,
    connection: ConnectionTCPObfuscated,
    deviceModel: 'Android Mobile',
    systemVersion: 'Android 14',
    appVersion: '1.0.0',
    langCode: 'en',
    systemLangCode: 'en',
  });
  
  return client;
}

export async function startAuth(phoneNumber: string): Promise<{ phoneCodeHash: string }> {
  const c = await initializeClient();
  if (!c) throw new Error('Failed to initialize client');
  
  await c.connect();
  const result: any = await c.invoke(
    new Api.auth.SendCode({
      phoneNumber,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({}),
    })
  );
  
  return { phoneCodeHash: result.phoneCodeHash };
}

export async function signIn(phoneNumber: string, code: string, phoneCodeHash: string): Promise<boolean> {
  const c = await initializeClient();
  if (!c) throw new Error('Failed to initialize client');
  
  try {
    await c.invoke(
      new Api.auth.SignIn({
        phoneNumber,
        phoneCodeHash,
        phoneCode: code,
      })
    );
    
    const sessionStr = c.session.save();
    await SecureStoreLib.saveSession(sessionStr);
    await SecureStoreLib.savePhone(phoneNumber);
    
    return true;
  } catch (error: any) {
    if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      throw new Error('2FA_PASSWORD_REQUIRED');
    }
    throw error;
  }
}

export async function signInWithPassword(password: string): Promise<boolean> {
  const c = await initializeClient();
  if (!c) throw new Error('Failed to initialize client');
  
  await c.connect();
  const passwordSrp: any = await c.invoke(new Api.account.GetPassword());
  const passwordSrpCheck = await computeCheck(passwordSrp, password);
  
  await c.invoke(
    new Api.auth.CheckPassword({
      password: passwordSrpCheck,
    })
  );
  
  const sessionStr = c.session.save();
  await SecureStoreLib.saveSession(sessionStr);
  return true;
}

export async function isLoggedIn(): Promise<boolean> {
  try {
    const session = await SecureStoreLib.getSession();
    if (!session) return false;
    const c = await initializeClient();
    if (!c) return false;
    await c.connect();
    const me = await c.getMe();
    return !!me;
  } catch {
    return false;
  }
}

export async function getMe() {
  const c = await initializeClient();
  if (!c) throw new Error('Not initialized');
  await c.connect();
  return await c.getMe();
}

export async function sendFile(file: any, caption?: string, chatId?: any): Promise<any> {
  const c = await initializeClient();
  if (!c) throw new Error('Not initialized');
  await c.connect();
  
  const target: any = chatId || 'me';
  const result = await c.sendFile(target, {
    file: file,
    caption: caption || '',
    forceDocument: false,
  });
  
  return result;
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
  }
}
