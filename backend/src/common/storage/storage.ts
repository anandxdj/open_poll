import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { S3Storage } from './s3.storage';

/**
 * Object storage behind one interface (S3-compatible: AWS S3, R2, MinIO,
 * RustFS). Browsers upload straight to presigned PUT URLs and objects are
 * served from the public/CDN base URL, never through the API (which sends
 * Cross-Origin-Resource-Policy: same-site).
 *
 * Without S3_* configuration `storage.enabled` is false and every call fails
 * with 503 STORAGE_DISABLED.
 */

export interface PresignedUpload {
  key: string;
  url: string;
  method: 'PUT';
  /** Headers the client must send with the PUT. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObjectInfo {
  key: string;
  size: number;
  /** Content-Type the object was stored with. */
  type: string;
  etag?: string;
  lastModified?: Date;
}

export interface StoredObject extends StoredObjectInfo {
  stream(): ReadableStream<Uint8Array>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export type StorageBody = string | Uint8Array | ArrayBuffer | Blob;

export interface StorageDriver {
  readonly enabled: boolean;
  /**
   * URL the client PUTs the file to. Presigned PUTs cannot cap the size or pin
   * the type, so `bytes`/`mime` are the declared values: verify the stored
   * object with stat() before trusting it (see uploads.service complete()).
   */
  presignPut(key: string, mime: string, bytes: number, options?: { expiresInSeconds?: number }): Promise<PresignedUpload>;
  /** Public URL of an object (anyone with it can read the object). */
  publicUrl(key: string): string;
  /** null when the object does not exist. */
  stat(key: string): Promise<StoredObjectInfo | null>;
  /** 404 STORAGE_OBJECT_NOT_FOUND when missing. */
  getObject(key: string): Promise<StoredObject>;
  /** Server-side write (import renders, export archives). */
  putObject(key: string, body: StorageBody, mime: string): Promise<void>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
}

export const storageDisabledError = () =>
  new ApiError(503, 'File storage is not configured on this server', 'STORAGE_DISABLED');

export const objectNotFoundError = () => new ApiError(404, 'Stored file not found', 'STORAGE_OBJECT_NOT_FOUND');

/** Relative keys of safe characters only: no leading slash, no `.`/`..` segments. */
export function assertValidKey(key: string): void {
  const valid =
    key.length > 0 &&
    key.length <= 512 &&
    /^[A-Za-z0-9!_.*'()/-]+$/.test(key) &&
    !key.startsWith('/') &&
    key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  if (!valid) throw ApiError.badRequest('Invalid storage key');
}

export class DisabledStorage implements StorageDriver {
  readonly enabled = false;
  async presignPut(): Promise<PresignedUpload> {
    throw storageDisabledError();
  }
  publicUrl(): string {
    throw storageDisabledError();
  }
  async stat(): Promise<StoredObjectInfo | null> {
    throw storageDisabledError();
  }
  async getObject(): Promise<StoredObject> {
    throw storageDisabledError();
  }
  async putObject(): Promise<void> {
    throw storageDisabledError();
  }
  async delete(): Promise<void> {
    throw storageDisabledError();
  }
}

export function createStorage(config: typeof env.storage = env.storage): StorageDriver {
  return config ? new S3Storage(config) : new DisabledStorage();
}

// Created on first use: s3.storage.ts imports this module, so building the
// driver at load time would depend on which of the two loads first.
let driver: StorageDriver | null = null;
const active = () => (driver ??= createStorage());

/** Swaps the active driver (tests, or a fake in local tooling). Returns the previous one. */
export function setStorageDriver(next: StorageDriver): StorageDriver {
  const previous = active();
  driver = next;
  return previous;
}

/** The process-wide storage; delegates to the active driver. */
export const storage: StorageDriver = {
  get enabled() {
    return active().enabled;
  },
  presignPut: (key, mime, bytes, options) => active().presignPut(key, mime, bytes, options),
  publicUrl: (key) => active().publicUrl(key),
  stat: (key) => active().stat(key),
  getObject: (key) => active().getObject(key),
  putObject: (key, body, mime) => active().putObject(key, body, mime),
  delete: (key) => active().delete(key),
};
