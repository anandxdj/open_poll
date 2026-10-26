import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

export const DOMAIN_STATUSES = ['pending', 'active', 'failed'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** Most custom domains one workspace keeps. */
export const MAX_CUSTOM_DOMAINS = 10;

/**
 * A hostname a workspace serves its participant pages on (W4-E), e.g.
 * polls.acme.com. Proven by a TXT record and routed by a CNAME to the
 * server's DOMAIN_CNAME_TARGET; `active` once both check out and the
 * provisioner has it.
 */
export interface ICustomDomain extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  hostname: string;
  status: DomainStatus;
  /** `openpoll-verify=<token>` at `_openpoll.<hostname>`. */
  verificationToken: string;
  /** What the last check found; shown to the admin. */
  checks: { txt: boolean; cname: boolean; checkedAt: Date | null; error: string | null };
  provisioner: 'vercel' | 'caddy';
  activatedAt: Date | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const customDomainSchema = new Schema<ICustomDomain>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    hostname: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: DOMAIN_STATUSES, default: 'pending' },
    verificationToken: { type: String, required: true },
    checks: {
      txt: { type: Boolean, default: false },
      cname: { type: Boolean, default: false },
      checkedAt: { type: Date, default: null },
      error: { type: String, default: null },
    },
    provisioner: { type: String, enum: ['vercel', 'caddy'], required: true },
    activatedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  // Production indexes come from migrations (bun run migrate), not boot.
  { timestamps: true, autoIndex: !env.isProduction },
);

customDomainSchema.index({ hostname: 1 }, { unique: true });
customDomainSchema.index({ workspaceId: 1, createdAt: 1 });

export const CustomDomainModel = mongoose.model<ICustomDomain>('CustomDomain', customDomainSchema);
