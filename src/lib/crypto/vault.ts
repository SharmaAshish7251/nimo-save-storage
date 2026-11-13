import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import aesjs from 'aes-js';
import { Buffer } from 'buffer';

// ─── Storage keys (salt + verifier only — raw key is NEVER persisted) ────────
const VAULT_SALT_STORE = 'nimo_vault_salt';
const VAULT_VERIFIER_STORE = 'nimo_vault_verifier';

// Legacy key store — read-only for migration, never written
const LEGACY_VAULT_KEY_STORE = 'nimo_vault_key';

// File format headers
const ENC_MAGIC_HEADER_V1 = 'NIMO_ENC_V1:'; // Legacy: AES-CTR, base64-char encryption (BUGGY — kept for read-compat only)
const ENC_MAGIC_HEADER_V2 = 'NIMO_ENC_V2:'; // Current: AES-CTR, correct raw-byte encryption

export interface VaultSyncMetadata {
  enabled: boolean;
  salt?: string;
  keyVerifier?: string;
}

// ─── SEC-04: Constant-time string comparison ─────────────────────────────────
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ─── Hex helpers ─────────────────────────────────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class VaultService {
  /**
   * SEC-02: Derives a 32-byte AES key from master password using PBKDF2-SHA256.
   *
   * Uses Web Crypto SubtleCrypto (available via globalThis.crypto.subtle in
   * React Native's Hermes engine with the polyfill from react-native-get-random-values).
   * Falls back to 100,000-round iterated SHA-256 if SubtleCrypto is unavailable.
   *
   * Target: ≥ 310,000 iterations per NIST SP 800-132 (2023) for SHA-256.
   */
  private async deriveKey(password: string, saltHex: string): Promise<Uint8Array> {
    const subtle = globalThis.crypto?.subtle;
    if (subtle && typeof subtle.importKey === 'function') {
      try {
        const enc = new TextEncoder();
        const saltBytes = hexToBytes(saltHex);
        const keyMaterial = await subtle.importKey(
          'raw',
          enc.encode(password) as unknown as BufferSource,
          'PBKDF2',
          false,
          ['deriveBits']
        );
        const bits = await subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes as unknown as BufferSource, iterations: 310000 },
          keyMaterial,
          256
        );
        return new Uint8Array(bits);
      } catch (e) {
        console.warn('[Vault] SubtleCrypto PBKDF2 failed, falling back to iterated SHA-256:', e);
      }
    }

    // Fallback: 100,000-round iterated SHA-256
    // Not as strong as PBKDF2 but significantly better than the original 100 rounds.
    let hash = `PBKDF2_FALLBACK:${password}:${saltHex}`;
    for (let i = 0; i < 100000; i++) {
      hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, hash);
    }
    return hexToBytes(hash);
  }

  /**
   * Derives a hex verifier string from the already-derived key bytes.
   * The verifier is safe to store: it proves password knowledge without revealing the key.
   */
  private async deriveVerifier(keyBytes: Uint8Array): Promise<string> {
    const keyHex = bytesToHex(keyBytes);
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `nimo_verifier_v2:${keyHex}`
    );
  }

  // ─── In-memory session key (SEC-03: never persisted) ─────────────────────
  private _sessionKey: Uint8Array | null = null;

  /**
   * SEC-03: Sets the master password.
   * Generates salt, derives key via PBKDF2, stores ONLY salt + verifier to SecureStore.
   * The raw key is held in memory for this session only.
   */
  async setMasterPassword(password: string): Promise<void> {
    const saltBytes = await Crypto.getRandomBytesAsync(16);
    const saltHex = bytesToHex(saltBytes);

    const keyBytes = await this.deriveKey(password, saltHex);
    const verifier = await this.deriveVerifier(keyBytes);

    // SEC-03: Store ONLY salt + verifier — never the raw key
    await SecureStore.setItemAsync(VAULT_SALT_STORE, saltHex);
    await SecureStore.setItemAsync(VAULT_VERIFIER_STORE, verifier);

    // Hold derived key in memory for this session
    this._sessionKey = keyBytes;
  }

  /**
   * Verifies the master password against the stored verifier.
   * Uses constant-time comparison (SEC-04).
   */
  async verifyMasterPassword(password: string): Promise<boolean> {
    const storedSalt = await SecureStore.getItemAsync(VAULT_SALT_STORE).catch(() => null);
    if (!storedSalt) return false;

    const candidateKey = await this.deriveKey(password, storedSalt);
    const candidateVerifier = await this.deriveVerifier(candidateKey);

    const storedVerifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    if (!storedVerifier) return false;

    // SEC-04: Constant-time comparison
    return timingSafeEqual(candidateVerifier, storedVerifier);
  }

  /**
   * Unlocks the in-memory session key after verifying the password.
   * Returns true if password is correct and session key is now active.
   */
  async unlockWithMasterPassword(password: string): Promise<boolean> {
    const storedSalt = await SecureStore.getItemAsync(VAULT_SALT_STORE).catch(() => null);
    const storedVerifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    if (!storedSalt || !storedVerifier) return false;

    const candidateKey = await this.deriveKey(password, storedSalt);
    const candidateVerifier = await this.deriveVerifier(candidateKey);

    // SEC-04: Constant-time comparison
    if (!timingSafeEqual(candidateVerifier, storedVerifier)) return false;

    this._sessionKey = candidateKey;
    return true;
  }

  /**
   * Locks the in-memory session key (clears it from memory).
   */
  lockSession(): void {
    if (this._sessionKey) {
      this._sessionKey.fill(0); // zero out memory
      this._sessionKey = null;
    }
  }

  /**
   * Returns true if a vault session key is currently held in memory.
   */
  get isUnlocked(): boolean {
    return this._sessionKey !== null;
  }

  /**
   * Returns true if the vault has been configured (salt + verifier exist).
   */
  async hasVaultKey(): Promise<boolean> {
    // SEC-03: Check verifier (not raw key — raw key is never stored)
    const verifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    return Boolean(verifier);
  }

  async isVaultConfigured(): Promise<boolean> {
    return this.hasVaultKey();
  }

  async clearVaultKey(): Promise<void> {
    this.lockSession();
    await SecureStore.deleteItemAsync(VAULT_SALT_STORE).catch(() => {});
    await SecureStore.deleteItemAsync(VAULT_VERIFIER_STORE).catch(() => {});
    // Also clean up legacy key store if it still exists
    await SecureStore.deleteItemAsync(LEGACY_VAULT_KEY_STORE).catch(() => {});
  }

  /**
   * Exports non-secret vault metadata for Telegram Cloud backup.
   * Does NOT export any plaintext password or raw AES key — only salt + verifier.
   */
  async exportVaultSyncMetadata(vaultEnabled: boolean = false): Promise<VaultSyncMetadata> {
    const salt = await SecureStore.getItemAsync(VAULT_SALT_STORE).catch(() => null);
    const verifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
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
   * Checks whether a file is encrypted by inspecting its magic header.
   */
  async isEncryptedFile(uri: string): Promise<boolean> {
    try {
      const header = await FileSystem.readAsStringAsync(uri, {
        length: Math.max(ENC_MAGIC_HEADER_V1.length, ENC_MAGIC_HEADER_V2.length),
        position: 0,
      });
      return header.startsWith(ENC_MAGIC_HEADER_V1) || header.startsWith(ENC_MAGIC_HEADER_V2);
    } catch {
      return false;
    }
  }

  /**
   * Returns the active session key, throwing if vault is locked.
   */
  private requireSessionKey(): Uint8Array {
    if (!this._sessionKey) {
      throw new Error('Vault is locked. Please unlock with your master password in Settings.');
    }
    return this._sessionKey;
  }

  /**
   * Migrates legacy SecureStore data: if the old raw key store exists but
   * the new verifier does not, re-derive and store verifier using the legacy key.
   * Called once on first unlock attempt after app update.
   */
  async migrateLegacyKeyStore(): Promise<void> {
    const hasNewVerifier = await SecureStore.getItemAsync(VAULT_VERIFIER_STORE).catch(() => null);
    if (hasNewVerifier) return; // Already migrated

    const legacyKey = await SecureStore.getItemAsync(LEGACY_VAULT_KEY_STORE).catch(() => null);
    const legacySalt = await SecureStore.getItemAsync(VAULT_SALT_STORE).catch(() => null);
    if (!legacyKey || !legacySalt) return;

    // Re-derive verifier from the legacy key hex
    const legacyKeyBytes = hexToBytes(legacyKey.substring(0, 64));
    const verifier = await this.deriveVerifier(legacyKeyBytes);
    await SecureStore.setItemAsync(VAULT_VERIFIER_STORE, verifier);

    // Delete the legacy raw key — it should not remain stored
    await SecureStore.deleteItemAsync(LEGACY_VAULT_KEY_STORE).catch(() => {});

    console.log('[Vault] Migrated legacy key store: raw key removed, verifier stored.');
  }

  // ─── BUG-02 / SEC-07: Encryption (AES-256-CTR, raw bytes, V2 format) ──────

  /**
   * Encrypts a file using AES-256-CTR and writes to destUri with IV prepended.
   *
   * V2 format: `NIMO_ENC_V2:<ivHex>:<base64(encrypted_raw_bytes_chunk)>...`
   * - Encrypts the RAW file bytes (not base64 characters — that was the V1 bug)
   * - Stores encrypted data as base64 (1.33× overhead vs 2× for hex)
   * - Uses streaming I/O to keep peak memory under ~25 MB
   */
  async encryptFile(sourceUri: string, destUri: string): Promise<{ iv: string }> {
    const keyBytes = this.requireSessionKey();

    const ivBytes = await Crypto.getRandomBytesAsync(16);
    const ivHex = bytesToHex(ivBytes);

    const aesCtr = new aesjs.ModeOfOperation.ctr(Array.from(keyBytes), new aesjs.Counter(Array.from(ivBytes)));

    // Remove any existing dest file
    const existing = await FileSystem.getInfoAsync(destUri).catch(() => ({ exists: false }));
    if ((existing as any).exists) {
      await FileSystem.deleteAsync(destUri, { idempotent: true });
    }

    // Write V2 header
    const header = `${ENC_MAGIC_HEADER_V2}${ivHex}:`;
    await FileSystem.writeAsStringAsync(destUri, header, { encoding: 'utf8' });

    const fileInfo = await (FileSystem as any).getInfoAsync(sourceUri, { size: true });
    const totalBytes: number = (fileInfo as any)?.size ?? 0;

    // Stream in 3 MB raw byte chunks
    const CHUNK_SIZE = 3 * 1024 * 1024;
    let byteOffset = 0;

    if (totalBytes <= 0) {
      // Small / virtual URI: read full content and encrypt raw bytes
      const base64Content = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'base64' });
      const rawBytes = Array.from(Buffer.from(base64Content, 'base64'));
      const encryptedBytes = aesCtr.encrypt(rawBytes);
      const encryptedB64 = Buffer.from(encryptedBytes).toString('base64');
      await (FileSystem as any).writeAsStringAsync(destUri, encryptedB64, {
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

      // BUG-02 FIX: Decode base64 → raw bytes, then encrypt the raw bytes
      const rawBytes = Array.from(Buffer.from(base64Chunk, 'base64'));
      const encryptedBytes = aesCtr.encrypt(rawBytes);
      const encryptedB64 = Buffer.from(encryptedBytes).toString('base64');

      await (FileSystem as any).writeAsStringAsync(destUri, encryptedB64, {
        encoding: 'utf8',
        append: true,
      });

      // Advance by actual raw bytes read (decoded from base64)
      const decodedBytes = Math.floor((base64Chunk.replace(/=/g, '').length * 3) / 4);
      byteOffset += decodedBytes;

      // Yield event loop
      await new Promise((r) => setTimeout(r, 0));
    }

    return { iv: ivHex };
  }

  /**
   * Decrypts a vault-encrypted file back to original file content at destUri.
   * Handles both V2 (correct) and V1 (legacy, buggy-but-readable) formats.
   */
  async decryptFile(sourceUri: string, destUri: string): Promise<void> {
    const keyBytes = this.requireSessionKey();

    // Read enough header to detect format
    const headerPrefix = await FileSystem.readAsStringAsync(sourceUri, {
      position: 0,
      length: 80,
    }).catch(() => '');

    if (headerPrefix.startsWith(ENC_MAGIC_HEADER_V2)) {
      await this._decryptV2(sourceUri, destUri, headerPrefix, keyBytes);
    } else if (headerPrefix.startsWith(ENC_MAGIC_HEADER_V1)) {
      await this._decryptV1Legacy(sourceUri, destUri, headerPrefix, keyBytes);
    } else {
      // Not encrypted — copy as-is
      await FileSystem.copyAsync({ from: sourceUri, to: destUri });
    }
  }

  /**
   * V2 decryption: encrypted data is base64(encrypted_raw_bytes) stored as plain text chunks.
   */
  private async _decryptV2(
    sourceUri: string,
    destUri: string,
    headerPrefix: string,
    keyBytes: Uint8Array
  ): Promise<void> {
    const colonIdx = headerPrefix.indexOf(':', ENC_MAGIC_HEADER_V2.length);
    if (colonIdx === -1) throw new Error('Corrupted V2 encrypted file: missing IV delimiter.');

    const ivHex = headerPrefix.substring(ENC_MAGIC_HEADER_V2.length, colonIdx);
    const headerTotalLength = colonIdx + 1;

    const ivBytes = hexToBytes(ivHex);
    const aesCtr = new aesjs.ModeOfOperation.ctr(Array.from(keyBytes), new aesjs.Counter(Array.from(ivBytes)));

    const fileInfo = await (FileSystem as any).getInfoAsync(sourceUri, { size: true });
    const totalFileChars: number = (fileInfo as any)?.size ?? 0;

    const existing = await FileSystem.getInfoAsync(destUri).catch(() => ({ exists: false }));
    if ((existing as any).exists) {
      await FileSystem.deleteAsync(destUri, { idempotent: true });
    }

    if (totalFileChars <= 10 * 1024 * 1024) {
      // Small file: single-shot decrypt
      const payload = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'utf8' });
      const encryptedB64 = payload.substring(headerTotalLength);
      const encryptedBytes = Array.from(Buffer.from(encryptedB64, 'base64'));
      const decryptedBytes = aesCtr.decrypt(encryptedBytes);
      const rawB64 = Buffer.from(decryptedBytes).toString('base64');
      await FileSystem.writeAsStringAsync(destUri, rawB64, { encoding: 'base64' });
      return;
    }

    // Large file: stream in base64 text chunks
    // Each chunk of base64 text represents encrypted raw bytes
    const CHUNK_B64_LEN = 4 * 1024 * 1024; // 4 MB text ≈ 3 MB encrypted bytes
    let charOffset = headerTotalLength;
    let isFirstChunk = true;

    while (charOffset < totalFileChars) {
      const toReadChars = Math.min(CHUNK_B64_LEN, totalFileChars - charOffset);
      const b64Chunk = await (FileSystem as any).readAsStringAsync(sourceUri, {
        position: charOffset,
        length: toReadChars,
      });

      if (!b64Chunk || b64Chunk.length === 0) break;

      const encryptedBytes = Array.from(Buffer.from(b64Chunk, 'base64'));
      const decryptedBytes = aesCtr.decrypt(encryptedBytes);
      const rawB64 = Buffer.from(decryptedBytes).toString('base64');

      if (isFirstChunk) {
        await FileSystem.writeAsStringAsync(destUri, rawB64, { encoding: 'base64' });
        isFirstChunk = false;
      } else {
        await (FileSystem as any).writeAsStringAsync(destUri, rawB64, {
          encoding: FileSystem.EncodingType.Base64,
          append: true,
        });
      }

      charOffset += b64Chunk.length;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /**
   * V1 (legacy) decryption: encrypted data is hex(encrypt(utf8_bytes_of_base64_string)).
   * This is the original buggy format — kept read-only for backward compatibility.
   * After a successful V1 decrypt, callers should re-encrypt as V2.
   */
  private async _decryptV1Legacy(
    sourceUri: string,
    destUri: string,
    headerPrefix: string,
    keyBytes: Uint8Array
  ): Promise<void> {
    const colonIdx = headerPrefix.indexOf(':', ENC_MAGIC_HEADER_V1.length);
    if (colonIdx === -1) throw new Error('Corrupted V1 encrypted file: missing IV delimiter.');

    const ivHex = headerPrefix.substring(ENC_MAGIC_HEADER_V1.length, colonIdx);
    const headerTotalLength = colonIdx + 1;

    const ivBytes = hexToBytes(ivHex);
    const aesCtr = new aesjs.ModeOfOperation.ctr(Array.from(keyBytes), new aesjs.Counter(Array.from(ivBytes)));

    const fileInfo = await (FileSystem as any).getInfoAsync(sourceUri, { size: true });
    const totalFileChars: number = (fileInfo as any)?.size ?? 0;

    const existing = await FileSystem.getInfoAsync(destUri).catch(() => ({ exists: false }));
    if ((existing as any).exists) {
      await FileSystem.deleteAsync(destUri, { idempotent: true });
    }

    // V1 used hex encoding and utf8.toBytes/fromBytes — handle the legacy path
    if (totalFileChars <= 10 * 1024 * 1024) {
      const payload = await FileSystem.readAsStringAsync(sourceUri, { encoding: 'utf8' });
      const encryptedHex = payload.substring(headerTotalLength);
      const encryptedBytes = aesjs.utils.hex.toBytes(encryptedHex);
      const decryptedBytes = aesCtr.decrypt(encryptedBytes);
      const base64Content = aesjs.utils.utf8.fromBytes(decryptedBytes);
      await FileSystem.writeAsStringAsync(destUri, base64Content, { encoding: 'base64' });
      return;
    }

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
