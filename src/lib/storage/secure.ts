import * as SecureStore from 'expo-secure-store';

const KEYS = {
  TELEGRAM_API_ID: 'tg_api_id',
  TELEGRAM_API_HASH: 'tg_api_hash',
  TELEGRAM_SESSION: 'tg_session',
  TELEGRAM_PHONE: 'tg_phone',
  CONFIG: 'app_config',
  UPLOAD_QUEUE: 'upload_queue',
  UPLOADED_INDEX: 'uploaded_index',
  LAST_SCAN: 'last_scan',
} as const;

export async function saveApiCredentials(apiId: string, apiHash: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.TELEGRAM_API_ID, apiId);
  await SecureStore.setItemAsync(KEYS.TELEGRAM_API_HASH, apiHash);
}

export async function getApiCredentials(): Promise<{ apiId: string | null; apiHash: string | null }> {
  const [storedId, storedHash] = await Promise.all([
    SecureStore.getItemAsync(KEYS.TELEGRAM_API_ID),
    SecureStore.getItemAsync(KEYS.TELEGRAM_API_HASH),
  ]);
  const envId = process.env.EXPO_PUBLIC_TELEGRAM_API_ID || null;
  const envHash = process.env.EXPO_PUBLIC_TELEGRAM_API_HASH || null;
  return {
    apiId: storedId || envId,
    apiHash: storedHash || envHash,
  };
}

export async function saveSession(session: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.TELEGRAM_SESSION, session);
}

export async function getSession(): Promise<string | null> {
  return await SecureStore.getItemAsync(KEYS.TELEGRAM_SESSION);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.TELEGRAM_SESSION);
}

export async function savePhone(phone: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.TELEGRAM_PHONE, phone);
}

export async function getPhone(): Promise<string | null> {
  return await SecureStore.getItemAsync(KEYS.TELEGRAM_PHONE);
}

export async function hasApiCredentials(): Promise<boolean> {
  const { apiId, apiHash } = await getApiCredentials();
  return Boolean(apiId && apiHash);
}

export async function clearApiCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.TELEGRAM_API_ID).catch(() => {});
  await SecureStore.deleteItemAsync(KEYS.TELEGRAM_API_HASH).catch(() => {});
}
