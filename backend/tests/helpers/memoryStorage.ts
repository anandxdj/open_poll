import type { PresignedUpload, StorageBody, StorageDriver, StoredObject, StoredObjectInfo } from '../../src/common/storage/storage';
import { ApiError } from '../../src/common/utils/ApiError';

/** An in-memory bucket for tests: enabled, public URLs under `https://cdn.test`. */
export class MemoryStorage implements StorageDriver {
  readonly enabled = true;
  readonly objects = new Map<string, { bytes: Uint8Array; type: string }>();

  async presignPut(key: string, mime: string): Promise<PresignedUpload> {
    return { key, url: `https://cdn.test/put/${key}`, method: 'PUT', headers: { 'Content-Type': mime }, expiresAt: new Date(Date.now() + 900_000) };
  }

  publicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    const object = this.objects.get(key);
    return object ? { key, size: object.bytes.length, type: object.type } : null;
  }

  async getObject(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) throw new ApiError(404, 'Stored file not found', 'STORAGE_OBJECT_NOT_FOUND');
    return {
      key,
      size: object.bytes.length,
      type: object.type,
      stream: () => new Blob([object.bytes]).stream() as ReadableStream<Uint8Array>,
      bytes: async () => object.bytes,
      text: async () => new TextDecoder().decode(object.bytes),
    };
  }

  async putObject(key: string, body: StorageBody, mime: string): Promise<void> {
    const bytes =
      typeof body === 'string' ? new TextEncoder().encode(body) : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body as ArrayBuffer);
    this.objects.set(key, { bytes, type: mime });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
