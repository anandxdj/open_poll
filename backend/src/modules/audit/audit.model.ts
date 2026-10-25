import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

export const AUDIT_ACTOR_TYPES = ['user', 'scim', 'system', 'api'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** One security-relevant action. Written by common/audit/audit.ts; removed by TTL at expiresAt. */
export interface IAuditEvent extends Document {
  _id: Types.ObjectId;
  workspaceId?: Types.ObjectId | null;
  actorId?: Types.ObjectId | null;
  actorType: AuditActorType;
  /** Dotted verb, e.g. `media.upload`, `workspace.plan.set`, `member.role.update`. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  ua?: string | null;
  meta?: Record<string, unknown> | null;
  expiresAt: Date | null;
  createdAt: Date;
}

const auditEventSchema = new Schema<IAuditEvent>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    // A User for actorType user; the ScimToken or McpToken id for scim/api.
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorType: { type: String, enum: AUDIT_ACTOR_TYPES, required: true },
    action: { type: String, required: true, maxlength: 100 },
    targetType: { type: String, default: null, maxlength: 50 },
    // Strings so non-ObjectId targets (SCIM externalIds, domains) fit too.
    targetId: { type: String, default: null, maxlength: 200 },
    ip: { type: String, default: null },
    ua: { type: String, default: null, maxlength: 512 },
    meta: { type: Schema.Types.Mixed, default: null },
    // null = kept indefinitely (unlimited auditRetentionDays); the TTL index skips it.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, autoIndex: !env.isProduction },
);

auditEventSchema.index({ workspaceId: 1, createdAt: -1 });
auditEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuditEventModel = mongoose.model<IAuditEvent>('AuditEvent', auditEventSchema);
