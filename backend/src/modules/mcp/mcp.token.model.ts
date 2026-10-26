import mongoose, { Schema, type Document } from 'mongoose';
import type { McpScope } from './mcp.constants';

export interface IMcpToken extends Document {
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  prefix: string;
  last4: string;
  label: string;
  scopes: McpScope[];
  /** Workspace the token acts in; null = the user's default workspace at call time. */
  workspaceId?: mongoose.Types.ObjectId | null;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const mcpTokenSchema = new Schema<IMcpToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true },
    last4: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    scopes: {
      type: [String],
      required: true,
      default: [],
    },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const McpTokenModel = mongoose.model<IMcpToken>('McpToken', mcpTokenSchema);
