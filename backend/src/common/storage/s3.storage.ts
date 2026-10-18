import type { AppEnv } from '../config/env';
import {
  assertValidKey,
  objectNotFoundError,
  type PresignedUpload,
  type StorageBody,
  type StorageDriver,
  type StoredObject,
  type StoredObjectInfo,
} from './storage';

type S3Config = NonNullable<AppEnv['storage']>;

const DEFAULT_PRESIGN_SECONDS = 15 * 60;

const isMissing = (error: unknown) => {
  const { code, name } = (error ?? {}) as { code?: string; name?: string };
  return code === 'NoSuchKey' || code === 'NotFound' || name === 'NotFound';
};

/** S3-compatible driver on Bun's native client (path-style URLs; R2, MinIO, RustFS, AWS). */
export class S3Storage implements StorageDriver {
  readonly enabled = true;
  private readonly client: Bun.S3Client;
  private readonly publicBase: string;

  constructor(config: S3Config, client?: Bun.S3Client) {
    this.client =
      client ??
      new Bun.S3Client({
        bucket: config.bucket,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      });
    this.publicBase = config.publicUrl.replace(/\/+$/, '');
  }

  async presignPut(
    key: string,
    mime: string,
    _bytes: number,
    options: { expiresInSeconds?: number } = {},
  ): Promise<PresignedUpload> {
    assertValidKey(key);
    const expiresIn = options.expiresInSeconds ?? DEFAULT_PRESIGN_SECONDS;
    const url = this.client.presign(key, { method: 'PUT', expiresIn });
    return {
      key,
      url,
      method: 'PUT',
      headers: { 'Content-Type': mime },
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    assertValidKey(key);
    try {
      const stats = await this.client.file(key).stat();
      return {
        key,
        size: stats.size,
        type: stats.type,
        etag: stats.etag,
        lastModified: stats.lastModified,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async getObject(key: string): Promise<StoredObject> {
    const info = await this.stat(key);
    if (!info) throw objectNotFoundError();
    const file = this.client.file(key);
    return {
      ...info,
      stream: () => file.stream(),
      bytes: () => file.bytes(),
      text: () => file.text(),
    };
  }

  async putObject(key: string, body: StorageBody, mime: string): Promise<void> {
    assertValidKey(key);
    await this.client.write(key, body, { type: mime });
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    try {
      await this.client.delete(key);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}
