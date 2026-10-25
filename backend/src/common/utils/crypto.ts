import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * AES-256-GCM for secrets stored in Mongo (per-workspace SSO client secrets).
 * Key: ENCRYPTION_KEY (32 bytes). Output: `v1.<iv>.<tag>.<ciphertext>`, each
 * part base64url; a fresh 96-bit IV per call. Optional associated data binds a
 * ciphertext to its context (e.g. the SsoConnection id), so it cannot be copied
 * onto another record and still decrypt.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class EncryptionUnavailableError extends Error {
  constructor() {
    super('ENCRYPTION_KEY is not configured');
    this.name = 'EncryptionUnavailableError';
  }
}

const requireKey = (key: Buffer | null | undefined): Buffer => {
  if (!key) throw new EncryptionUnavailableError();
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  return key;
};

export const isEncryptionConfigured = () => env.encryptionKey !== null;

export function encryptSecret(plaintext: string, associatedData?: string, key: Buffer | null = env.encryptionKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', requireKey(key), iv, { authTagLength: TAG_BYTES });
  if (associatedData !== undefined) cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Throws on a wrong key, wrong associated data or any tampering. */
export function decryptSecret(payload: string, associatedData?: string, key: Buffer | null = env.encryptionKey): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unrecognised encrypted value');
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Unrecognised encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', requireKey(key), iv, { authTagLength: TAG_BYTES });
  if (associatedData !== undefined) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}
