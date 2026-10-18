import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';
import { PLAN_IDS, type PlanId, type PlanOverrides } from '../../common/plans/plans';

export const WORKSPACE_TYPES = ['personal', 'team'] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];
export const PLAN_SOURCES = ['default', 'stripe', 'manual'] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export interface IWorkspaceBilling {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  /** Stripe subscription status (active, trialing, past_due, canceled, ...). */
  status?: string | null;
  priceId?: string | null;
  seats?: number | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

export interface IWorkspaceSettings {
  /** Session data retention chosen by the workspace, capped by the plan's retentionDays. */
  retentionDays?: number | null;
  requireSso: boolean;
  allowedEmailDomains: string[];
  embedAllowedOrigins: string[];
  defaultTheme?: unknown;
}

export interface IWorkspace extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  type: WorkspaceType;
  ownerId: Types.ObjectId;
  plan: PlanId;
  planSource: PlanSource;
  /** Per-workspace deviations from the plan defaults (enterprise contracts, support grants). */
  planOverrides?: PlanOverrides | null;
  billing: IWorkspaceBilling;
  settings: IWorkspaceSettings;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const billingSchema = new Schema<IWorkspaceBilling>(
  {
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    status: { type: String, default: null },
    priceId: { type: String, default: null },
    seats: { type: Number, default: null, min: 0 },
    currentPeriodEnd: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
  },
  { _id: false },
);

const settingsSchema = new Schema<IWorkspaceSettings>(
  {
    retentionDays: { type: Number, default: null, min: 1 },
    requireSso: { type: Boolean, default: false },
    allowedEmailDomains: { type: [String], default: [] },
    embedAllowedOrigins: { type: [String], default: [] },
    defaultTheme: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const workspaceSchema = new Schema<IWorkspace>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, enum: WORKSPACE_TYPES, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, enum: PLAN_IDS, default: 'free' },
    planSource: { type: String, enum: PLAN_SOURCES, default: 'default' },
    planOverrides: { type: Schema.Types.Mixed, default: null },
    billing: { type: billingSchema, default: () => ({}) },
    settings: { type: settingsSchema, default: () => ({}) },
    deletedAt: { type: Date, default: null },
  },
  // Production indexes come from migrations (bun run migrate), not boot.
  { timestamps: true, autoIndex: !env.isProduction },
);

// One personal workspace per user; makes lazy provisioning safe under concurrency.
workspaceSchema.index(
  { ownerId: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: 'personal' }, name: 'personal_workspace_per_owner' },
);
workspaceSchema.index({ ownerId: 1 });
workspaceSchema.index(
  { 'billing.stripeCustomerId': 1 },
  { unique: true, partialFilterExpression: { 'billing.stripeCustomerId': { $type: 'string' } } },
);

export const WorkspaceModel = mongoose.model<IWorkspace>('Workspace', workspaceSchema);
