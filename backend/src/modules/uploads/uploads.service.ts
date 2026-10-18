import { randomUUID } from 'node:crypto';
import { redisClient } from '../../common/config/redis';
import { storage, storageDisabledError } from '../../common/storage/storage';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { ApiError } from '../../common/utils/ApiError';
import type { IWorkspace } from '../workspaces/workspace.model';
import { MediaAssetModel, type IMediaAsset } from './media.model';
import { UPLOAD_PURPOSES, type PresignUploadInput, type UploadPurpose } from './uploads.schema';

/** The caller after authenticate() + workspaceContext(). */
export type UploadContext = PolicyContext & { user: { id: string }; workspace: IWorkspace };

interface PendingUpload {
  userId: string;
  workspaceId: string;
  purpose: UploadPurpose;
  mime: string;
  bytes: number;
}

const PRESIGN_SECONDS = 15 * 60;
/** Long enough to finish a slow upload that started just before the URL expired. */
const PENDING_TTL_SECONDS = 60 * 60;

export const pendingUploadKey = (key: string) => `uploads:pending:${key}`;

const normalizeMime = (value: string) => value.split(';')[0]!.trim().toLowerCase();

const notFound = () => new ApiError(404, 'Upload not found or expired', 'UPLOAD_NOT_FOUND');

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

export class UploadsService {
  /**
   * Checks the declared type and size against the purpose's allow-list and the
   * caller's role, then returns a presigned PUT URL for a fresh object key.
   * The declaration is remembered for complete(), which verifies the object.
   */
  static async presign(ctx: UploadContext, input: PresignUploadInput) {
    if (!storage.enabled) throw storageDisabledError();
    const rule = UPLOAD_PURPOSES[input.purpose];
    assertCan(ctx, rule.action);

    const extension = (rule.types as Readonly<Record<string, string>>)[input.mime];
    if (!extension) {
      throw new ApiError(400, `This file type is not allowed for ${input.purpose}`, 'UPLOAD_TYPE_NOT_ALLOWED', {
        allowed: Object.keys(rule.types),
      });
    }
    if (input.bytes > rule.maxBytes) {
      throw new ApiError(413, 'File is too large', 'UPLOAD_TOO_LARGE', { maxBytes: rule.maxBytes });
    }

    const workspaceId = String(ctx.workspace._id);
    const now = new Date();
    const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `uploads/${workspaceId}/${input.purpose}/${month}/${randomUUID()}.${extension}`;

    const upload = await storage.presignPut(key, input.mime, input.bytes, { expiresInSeconds: PRESIGN_SECONDS });
    const pending: PendingUpload = {
      userId: ctx.user.id,
      workspaceId,
      purpose: input.purpose,
      mime: input.mime,
      bytes: input.bytes,
    };
    await redisClient.set(pendingUploadKey(key), JSON.stringify(pending), { EX: PENDING_TTL_SECONDS });

    return { ...upload, maxBytes: rule.maxBytes };
  }

  /**
   * Turns an uploaded object into a MediaAsset after checking that it exists
   * and matches what presign() was told: same type, no larger than declared.
   * A mismatching object is deleted. Repeating a finished completion returns
   * the same asset.
   */
  static async complete(ctx: UploadContext, key: string): Promise<{ asset: IMediaAsset; created: boolean }> {
    if (!storage.enabled) throw storageDisabledError();
    const workspaceId = String(ctx.workspace._id);

    const existing = await MediaAssetModel.findOne({ key, workspaceId });
    if (existing) return { asset: existing, created: false };

    const raw = await redisClient.get(pendingUploadKey(key));
    const pending = raw ? (JSON.parse(raw) as PendingUpload) : null;
    // Someone else's key is indistinguishable from an unknown one.
    if (!pending || pending.userId !== ctx.user.id || pending.workspaceId !== workspaceId) throw notFound();

    const info = await storage.stat(key);
    if (!info) throw new ApiError(409, 'The file has not been uploaded yet', 'UPLOAD_INCOMPLETE');

    const rule = UPLOAD_PURPOSES[pending.purpose];
    if (normalizeMime(info.type) !== pending.mime || info.size > pending.bytes || info.size > rule.maxBytes) {
      await storage.delete(key);
      await redisClient.del(pendingUploadKey(key));
      throw new ApiError(400, 'The uploaded file does not match the declared type or size', 'UPLOAD_MISMATCH');
    }

    let asset: IMediaAsset;
    let created = true;
    try {
      asset = await MediaAssetModel.create({
        workspaceId,
        uploaderId: ctx.user.id,
        key,
        url: storage.publicUrl(key),
        mime: pending.mime,
        bytes: info.size,
        source: 'upload',
        purpose: pending.purpose,
      });
    } catch (error) {
      // A concurrent completion of the same key won.
      if (!isDuplicateKey(error)) throw error;
      const winner = await MediaAssetModel.findOne({ key, workspaceId });
      if (!winner) throw error;
      asset = winner;
      created = false;
    }
    await redisClient.del(pendingUploadKey(key));
    return { asset, created };
  }
}
