import { describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decodeEncryptionKey } from '../src/common/config/env';
import { EncryptionUnavailableError, decryptSecret, encryptSecret } from '../src/common/utils/crypto';

const key = randomBytes(32);

describe('AES-256-GCM secrets', () => {
  it('round-trips, including unicode and empty strings', () => {
    for (const secret of ['client-secret-123', 'päss wörd ✓', '']) {
      expect(decryptSecret(encryptSecret(secret, undefined, key), undefined, key)).toBe(secret);
    }
  });

  it('uses a fresh IV every time', () => {
    const a = encryptSecret('same', undefined, key);
    const b = encryptSecret('same', undefined, key);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]*$/);
  });

  it('binds the ciphertext to its associated data', () => {
    const sealed = encryptSecret('secret', 'sso-connection:1', key);
    expect(decryptSecret(sealed, 'sso-connection:1', key)).toBe('secret');
    expect(() => decryptSecret(sealed, 'sso-connection:2', key)).toThrow();
    expect(() => decryptSecret(sealed, undefined, key)).toThrow();
  });

  it('rejects tampering and the wrong key', () => {
    const sealed = encryptSecret('secret', undefined, key);
    const [version, iv, tag, data] = sealed.split('.') as [string, string, string, string];
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([version, iv, tag, flipped.toString('base64url')].join('.'), undefined, key)).toThrow();
    expect(() => decryptSecret(sealed, undefined, randomBytes(32))).toThrow();
    expect(() => decryptSecret('v2.a.b.c', undefined, key)).toThrow('Unrecognised');
  });

  it('refuses to work without ENCRYPTION_KEY', () => {
    expect(() => encryptSecret('secret', undefined, null)).toThrow(EncryptionUnavailableError);
  });
});

describe('ENCRYPTION_KEY decoding', () => {
  it('accepts 64 hex characters and 32-byte base64 / base64url', () => {
    expect(decodeEncryptionKey(key.toString('hex'))?.equals(key)).toBe(true);
    expect(decodeEncryptionKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(decodeEncryptionKey(key.toString('base64url'))?.equals(key)).toBe(true);
  });

  it('rejects anything that is not exactly 32 bytes', () => {
    expect(decodeEncryptionKey('replace_with_a_key')).toBeNull();
    expect(decodeEncryptionKey(randomBytes(16).toString('hex'))).toBeNull();
    expect(decodeEncryptionKey(randomBytes(33).toString('base64'))).toBeNull();
  });
});
