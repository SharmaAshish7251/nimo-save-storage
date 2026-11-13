import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import aesjs from 'aes-js';

const VAULT_KEY_STORE = 'nimo_vault_key';
const VAULT_SALT_STORE = 'nimo_vault_salt';
const VAULT_VERIFIER_STORE = 'nimo_vault_verifier';
const ENC_MAGIC_HEADER = 'NIMO_ENC_V1:';

export interface VaultSyncMetadata {
  enabled: boolean;
  salt?: string;
  keyVerifier?: string;
}

export class VaultService {
  /**
   * Derives a 32-byte AES key from master password using iterated SHA-256.
   */
  private async deriveKey(password: string, salt: string): Promise<string> {
    let hash = `${password}_${salt}`;
    // 100 rounds provides high security while executing within ~80ms on mobile without freezing bridge
    for (let i = 0; i < 100; i++) {
      hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, hash);
    }
    return hash; // 64-char hex string = 32 bytes (256 bits)
  }

  async setMasterPassword(password: string): Promise<void> {
    // Generate cryptographically secure 16-byte salt using CSPRNG
    const saltBytes = await Crypto.getRandomBytesAsync(16);
    const salt = aesjs.utils.hex.fromBytes(saltBytes);
    const key = await this.deriveKey(password, salt);
    const verifier = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${key}_nimo_verifier`
    );
    await SecureStore.setItemAsync(VAULT_KEY_STORE, key);
    await SecureStore.setItemAsync(VAULT_SALT_STORE, salt);
    await SecureStore.setItemAsync(VAULT_VERIFIER_STORE, verifier);
  }

  async verifyMasterPassword(password: string): Promise<boolean> {
    const storedKey = await SecureStore.getItemAsync(VAULT_KEY_STORE).catch(() => null);
    const storedSalt = await SecureStore.getItemAsync(VAULT_SALT_STORE).catch(() => null);
    if (!storedSalt) return false;

    const candidateKey = await this.deriveKey(password, storedSalt);
    if (storedKey) {
      return candidateKey === storedKey;
    }
    const verifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    if (verifier) {
      const candidateVerifier = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${candidateKey}_nimo_verifier`
      );
      return candidateVerifier === verifier;
    }
    return false;
  }

  async hasVaultKey(): Promise<boolean> {
    const key = await SecureStore.getItemAsync(VAULT_KEY_STORE).catch(() => null);
    return Boolean(key);
  }

  async isVaultConfigured(): Promise<boolean> {
    const hasKey = await this.hasVaultKey();
    if (hasKey) return true;
    const verifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    return Boolean(verifier);
  }

  async clearVaultKey(): Promise<void> {
    await SecureStore.deleteItemAsync(VAULT_KEY_STORE).catch(() => {});
    await SecureStore.deleteItemAsync(VAULT_SALT_STORE).catch(() => {});
    await SecureStore.deleteItemAsync(VAULT_VERIFIER_STORE).catch(() => {});
  }

  /**
   * Exports non-secret vault metadata for Telegram Cloud backup.
   * Does NOT export plaintext password or raw derived AES key.
   */
  async exportVaultSyncMetadata(vaultEnabled: boolean = false): Promise<VaultSyncMetadata> {
    const salt = await SecureStore.getItemAsync(VAULT_SALT_STORE).catch(() => null);
    let verifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    if (!verifier) {
      const key = await SecureStore.getItemAsync(VAULT_KEY_STORE).catch(() => null);
      if (key) {
        verifier = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          `${key}_nimo_verifier`
        );
        await SecureStore.setItemAsync(VAULT_VERIFIER_STORE, verifier);
      }
    }
    return {
      enabled: vaultEnabled,
      ...(salt ? { salt } : {}),
      ...(verifier ? { keyVerifier: verifier } : {}),
    };
  }

  /**
   * Imports non-secret vault metadata restored from Telegram Cloud.
   */
  async importVaultSyncMetadata(metadata: VaultSyncMetadata): Promise<void> {
    if (metadata.salt) {
      await SecureStore.setItemAsync(VAULT_SALT_STORE, metadata.salt);
    }
    if (metadata.keyVerifier) {
      await SecureStore.setItemAsync(VAULT_VERIFIER_STORE, metadata.keyVerifier);
    }
  }

  /**
   * Unlocks vault after reinstall using the user's master password and restored salt/verifier.
   */
  async unlockWithMasterPassword(password: string): Promise<boolean> {
    const salt = await SecureStore.getItemAsync(VAULT_SALT_STORE).catch(() => null);
    const verifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    if (!salt || !verifier) return false;

    const candidateKey = await this.deriveKey(password, salt);
    const candidateVerifier = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${candidateKey}_nimo_verifier`
    );

    if (candidateVerifier === verifier) {
      await SecureStore.setItemAsync(VAULT_KEY_STORE, candidateKey);
      return true;
    }
    return false;
  }

  /**
   * Checks whether a file is encrypted by inspecting its magic header.
   */
  async isEncryptedFile(uri: string): Promise<boolean> {
    try {
      const header = await FileSystem.readAsStringAsync(uri, {
        length: ENC_MAGIC_HEADER.length,
        position: 0,
      });
      return header === ENC_MAGIC_HEADER;
    } catch {
      return false;
    }
  }

  /**
   * Encrypts a file using AES-256-CTR and writes to destUri with IV prepended.
   * Uses streaming I/O for large files to keep peak memory under ~20MB and avoid OOM crashes.
   */
  async encryptFile(sourceUri: string, destUri: string): Promise<{ iv: string }> {
    const keyHex = await SecureStore.getItemAsync(VAULT_KEY_STORE);
    if (!keyHex) {
      throw new Error('Vault is not initialized. Please set a master password in Settings.');
    }

    // Generate cryptographically secure 16-byte IV using CSPRNG
    const ivBytes = await Crypto.getRandomBytesAsync(16);
    const ivHex = aesjs.utils.hex.fromBytes(ivBytes);

    const keyBytes = aesjs.utils.hex.toBytes(keyHex.substring(0, 64));

    // Remove any existing dest file
    const existing = await FileSystem.getInfoAsync(destUri).catch(() => ({ exists: false }));
    if (existing.exists) {
      await FileSystem.deleteAsync(destUri, { idempotent: true });
    }

    // Write initial magic header: NIMO_ENC_V1:IV:
    const initialHeader = `${ENC_MAGIC_HEADER}${ivHex}:`;
    await FileSystem.writeAsStringAsync(destUri, initialHeader, { encoding: 'utf8' });

    const fileInfo = await (FileSystem as any).getInfoAsync(sourceUri, { size: true });
    const totalBytes: number = (fileInfo as any)?.size ?? 0;

    const aesCtr = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(ivBytes));

    // Stream in 3MB raw byte chunks (divisible by 3 for clean unpadded base64 reads)
    const CHUNK_SIZE = 3 * 1024 * 1024;
    let byteOffset = 0;

    if (totalBytes <= 0) {
      // Small or virtual content URI: read full base64 string
      const base64Content = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'base64' });
      const contentBytes = aesjs.utils.utf8.toBytes(base64Content);
      const encryptedBytes = aesCtr.encrypt(contentBytes);
      const encryptedHex = aesjs.utils.hex.fromBytes(encryptedBytes);
      await (FileSystem as any).writeAsStringAsync(destUri, encryptedHex, {
        encoding: 'utf8',
        append: true,
      });
      return { iv: ivHex };
    }

    while (byteOffset < totalBytes) {
      const toRead = Math.min(CHUNK_SIZE, totalBytes - byteOffset);
      const base64Chunk = await (FileSystem as any).readAsStringAsync(sourceUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: byteOffset,
        length: toRead,
      });

      if (!base64Chunk || base64Chunk.length === 0) break;

      const contentBytes = aesjs.utils.utf8.toBytes(base64Chunk);
      const encryptedBytes = aesCtr.encrypt(contentBytes);
      const encryptedHex = aesjs.utils.hex.fromBytes(encryptedBytes);

      await (FileSystem as any).writeAsStringAsync(destUri, encryptedHex, {
        encoding: 'utf8',
        append: true,
      });

      const decodedBytes = Math.floor((base64Chunk.replace(/=/g, '').length * 3) / 4);
      byteOffset += decodedBytes;

      // Yield event loop between chunks
      await new Promise((r) => setTimeout(r, 0));
    }

    return { iv: ivHex };
  }

  /**
   * Decrypts a vault-encrypted file back to original file content at destUri.
   * Streams chunks to prevent OOM on large files.
   */
  async decryptFile(sourceUri: string, destUri: string): Promise<void> {
    const keyHex = await SecureStore.getItemAsync(VAULT_KEY_STORE);
    if (!keyHex) {
      throw new Error('Vault key not found. Please set your vault password in Settings.');
    }

    // Inspect header (first 60 characters)
    const headerPrefix = await FileSystem.readAsStringAsync(sourceUri, {
      position: 0,
      length: 60,
    }).catch(() => '');

    if (!headerPrefix.startsWith(ENC_MAGIC_HEADER)) {
      // Not encrypted with our scheme, copy as is
      await FileSystem.copyAsync({ from: sourceUri, to: destUri });
      return;
    }

    const colonIdx = headerPrefix.indexOf(':', ENC_MAGIC_HEADER.length);
    if (colonIdx === -1) {
      throw new Error('Corrupted encrypted file structure.');
    }

    const ivHex = headerPrefix.substring(ENC_MAGIC_HEADER.length, colonIdx);
    const headerTotalLength = colonIdx + 1; // start of hex encrypted stream

    const keyBytes = aesjs.utils.hex.toBytes(keyHex.substring(0, 64));
    const ivBytes = aesjs.utils.hex.toBytes(ivHex);
    const aesCtr = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(ivBytes));

    const fileInfo = await (FileSystem as any).getInfoAsync(sourceUri, { size: true });
    const totalFileChars: number = (fileInfo as any)?.size ?? 0;

    // Remove any existing dest file
    const existing = await FileSystem.getInfoAsync(destUri).catch(() => ({ exists: false }));
    if (existing.exists) {
      await FileSystem.deleteAsync(destUri, { idempotent: true });
    }

    // If small (< 10MB), decrypt directly
    if (totalFileChars <= 10 * 1024 * 1024) {
      const payload = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'utf8' });
      const encryptedHex = payload.substring(headerTotalLength);
      const encryptedBytes = aesjs.utils.hex.toBytes(encryptedHex);
      const decryptedBytes = aesCtr.decrypt(encryptedBytes);
      const base64Content = aesjs.utils.utf8.fromBytes(decryptedBytes);
      await FileSystem.writeAsStringAsync(destUri, base64Content, { encoding: 'base64' });
      return;
    }

    // Stream decrypt in 4MB hex chunks (represents 2MB encrypted bytes)
    const CHUNK_HEX_LEN = 4 * 1024 * 1024;
    let charOffset = headerTotalLength;
    let isFirstChunk = true;

    while (charOffset < totalFileChars) {
      const toReadChars = Math.min(CHUNK_HEX_LEN, totalFileChars - charOffset);
      const hexChunk = await (FileSystem as any).readAsStringAsync(sourceUri, {
        position: charOffset,
        length: toReadChars,
      });

      if (!hexChunk || hexChunk.length === 0) break;

      const encryptedBytes = aesjs.utils.hex.toBytes(hexChunk);
      const decryptedBytes = aesCtr.decrypt(encryptedBytes);
      const base64Chunk = aesjs.utils.utf8.fromBytes(decryptedBytes);

      if (isFirstChunk) {
        await FileSystem.writeAsStringAsync(destUri, base64Chunk, { encoding: 'base64' });
        isFirstChunk = false;
      } else {
        await (FileSystem as any).writeAsStringAsync(destUri, base64Chunk, {
          encoding: FileSystem.EncodingType.Base64,
          append: true,
        });
      }

      charOffset += hexChunk.length;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

export const vaultService = new VaultService();

