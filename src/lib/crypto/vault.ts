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
    // 5000 rounds provides high security while executing within ~100ms on mobile
    for (let i = 0; i < 5000; i++) {
      hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, hash);
    }
    return hash; // 64-char hex string = 32 bytes (256 bits)
  }

  async setMasterPassword(password: string): Promise<void> {
    const salt = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${Date.now()}_${Math.random()}_vault_salt`
    );
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
   */
  async encryptFile(sourceUri: string, destUri: string): Promise<{ iv: string }> {
    const keyHex = await SecureStore.getItemAsync(VAULT_KEY_STORE);
    if (!keyHex) {
      throw new Error('Vault is not initialized. Please set a master password in Settings.');
    }

    // Generate random 16-byte IV
    const randomSeed = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${Date.now()}_${Math.random()}_iv`
    );
    const ivHex = randomSeed.substring(0, 32); // 16 bytes = 32 hex chars

    const keyBytes = aesjs.utils.hex.toBytes(keyHex.substring(0, 64));
    const ivBytes = aesjs.utils.hex.toBytes(ivHex);

    // Read source file as base64
    const base64Content = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'base64' });
    const contentBytes = aesjs.utils.utf8.toBytes(base64Content);

    // Encrypt with AES-256-CTR
    const aesCtr = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(ivBytes));
    const encryptedBytes = aesCtr.encrypt(contentBytes);
    const encryptedHex = aesjs.utils.hex.fromBytes(encryptedBytes);

    // Write file with header: NIMO_ENC_V1:IV:HEX
    const payload = `${ENC_MAGIC_HEADER}${ivHex}:${encryptedHex}`;
    await FileSystem.writeAsStringAsync(destUri, payload, { encoding: 'utf8' });

    return { iv: ivHex };
  }

  /**
   * Decrypts a vault-encrypted file back to original file content at destUri.
   */
  async decryptFile(sourceUri: string, destUri: string): Promise<void> {
    const keyHex = await SecureStore.getItemAsync(VAULT_KEY_STORE);
    if (!keyHex) {
      throw new Error('Vault key not found. Please set your vault password in Settings.');
    }

    const payload = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'utf8' });
    if (!payload.startsWith(ENC_MAGIC_HEADER)) {
      // Not encrypted with our scheme, copy as is
      await FileSystem.copyAsync({ from: sourceUri, to: destUri });
      return;
    }

    const rest = payload.substring(ENC_MAGIC_HEADER.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) {
      throw new Error('Corrupted encrypted file structure.');
    }

    const ivHex = rest.substring(0, colonIdx);
    const encryptedHex = rest.substring(colonIdx + 1);

    const keyBytes = aesjs.utils.hex.toBytes(keyHex.substring(0, 64));
    const ivBytes = aesjs.utils.hex.toBytes(ivHex);
    const encryptedBytes = aesjs.utils.hex.toBytes(encryptedHex);

    // Decrypt with AES-256-CTR
    const aesCtr = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(ivBytes));
    const decryptedBytes = aesCtr.decrypt(encryptedBytes);
    const base64Content = aesjs.utils.utf8.fromBytes(decryptedBytes);

    // Write decrypted content as base64
    await FileSystem.writeAsStringAsync(destUri, base64Content, { encoding: 'base64' });
  }
}

export const vaultService = new VaultService();

