import mongoose, { Schema, type Document } from 'mongoose';
import { env } from '../../common/config/env';

export const STRIPE_EVENT_STATUSES = ['processing', 'processed', 'failed'] as const;
export type StripeEventStatus = (typeof STRIPE_EVENT_STATUSES)[number];

/** How long processed events are remembered (Stripe retries for 3 days; manual resends up to 30). */
export const STRIPE_EVENT_RETENTION_DAYS = 90;

/**
 * One Stripe webhook event, keyed by the event id. The webhook inserts it
 * (status `processing`) before any side effect, so a replayed delivery finds
 * it and is acknowledged without running the handler twice. A failed handler
 * marks it `failed`; Stripe's retry then takes it over. `leaseUntil` lets a
 * retry take over an event whose worker crashed mid-way.
 */
export interface IStripeEvent extends Omit<Document, '_id'> {
  _id: string;
  type: string;
  livemode: boolean;
  status: StripeEventStatus;
  attempts: number;
  /** While `processing`: when another delivery may take the event over. */
  leaseUntil: Date | null;
  /** Last handler error (truncated); null once processed. */
  error: string | null;
  /** Stripe's `event.created`. */
  eventCreatedAt: Date | null;
  processedAt: Date | null;
  /** TTL: the record is removed after STRIPE_EVENT_RETENTION_DAYS. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stripeEventSchema = new Schema<IStripeEvent>(
  {
    _id: { type: String, required: true },
    type: { type: String, required: true, maxlength: 100 },
    livemode: { type: Boolean, default: false },
    status: { type: String, enum: STRIPE_EVENT_STATUSES, required: true },
    attempts: { type: Number, default: 1, min: 0 },
    leaseUntil: { type: Date, default: null },
    error: { type: String, default: null, maxlength: 500 },
    eventCreatedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  // Production indexes come from migration 120 (bun run migrate), not boot.
  { timestamps: true, autoIndex: !env.isProduction },
);

stripeEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const StripeEventModel = mongoose.model<IStripeEvent>('StripeEvent', stripeEventSchema);
