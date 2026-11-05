import mongoose, { Schema, type Document } from 'mongoose';
import type { McpScope } from '../mcp.constants';

/**
 * One approval on the consent page: a user let an OAuth client act in one
 * workspace with some scopes. Holds the current access and refresh tokens
 * (sha256 hashes only). Refresh tokens rotate; the previous one is kept so a
 * replayed refresh token revokes the whole grant. Disconnecting an app
 * deletes the grant, and the TTL index removes grants whose refresh token
 * expired a day ago.
 */
export interface IMcpGrant extends Document {
  userId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  clientId: string;
  /** client_name at approval, for the connected apps list. */
  clientName: string;
  scopes: McpScope[];
  accessTokenHash: string;
  accessExpiresAt: Date;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  refreshExpiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const mcpGrantSchema = new Schema<IMcpGrant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    clientId: { type: String, required: true },
    clientName: { type: String, required: true, trim: true, maxlength: 200 },
    scopes: { type: [String], required: true },
    accessTokenHash: { type: String, required: true, unique: true },
    accessExpiresAt: { type: Date, required: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    previousRefreshTokenHash: { type: String, default: null },
    refreshExpiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mcpGrantSchema.index({ userId: 1, createdAt: -1 });
mcpGrantSchema.index({ previousRefreshTokenHash: 1 }, { sparse: true });
mcpGrantSchema.index({ refreshExpiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const McpGrantModel = mongoose.model<IMcpGrant>('McpGrant', mcpGrantSchema);
