import { z } from 'zod';

/**
 * Plan catalogue: the single place plan features and limits are defined.
 * Limits apply whether or not Stripe billing is configured; without billing a
 * workspace's plan is set by hand (`bun scripts/set-plan.ts`).
 *
 * `null` as a limit means unlimited. Enterprise numbers are defaults for a
 * contract to override per workspace through `planOverrides`.
 */

export const PLAN_IDS = ['free', 'pro', 'team', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Boolean plan features, checked with requireFeature()/assertFeature(). */
export const FEATURES = [
  'export_csv',
  'export_xlsx',
  'export_pdf',
  'brand_kits',
  'sso',
  'scim',
  'custom_domains',
  'white_label',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Numeric plan limits, checked with assertLimit() or consumed monthly through usage counters. */
export const LIMIT_KEYS = [
  /** Concurrent participants in one live session. */
  'audienceCap',
  /** Active members of a workspace. */
  'seats',
  /** Longest session-data retention a workspace may choose. */
  'retentionDays',
  /** How long audit events are kept. */
  'auditRetentionDays',
  /** AI whole-deck generations per calendar month (usage counter `ai_deck`). */
  'aiDecksPerMonth',
  /** PPTX/PDF/Google Slides imports per calendar month (usage counter `import`). */
  'importsPerMonth',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type Limits = Record<LimitKey, number | null>;

/** Monthly usage counters and the limit each one consumes. */
export const USAGE_COUNTERS = {
  ai_deck: 'aiDecksPerMonth',
  import: 'importsPerMonth',
} as const satisfies Record<string, LimitKey>;
export type UsageCounterName = keyof typeof USAGE_COUNTERS;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  features: Record<Feature, boolean>;
  limits: Limits;
}

const NO_FEATURES: Record<Feature, boolean> = {
  export_csv: false,
  export_xlsx: false,
  export_pdf: false,
  brand_kits: false,
  sso: false,
  scim: false,
  custom_domains: false,
  white_label: false,
};

const PAID_FEATURES: Record<Feature, boolean> = {
  ...NO_FEATURES,
  export_csv: true,
  export_xlsx: true,
  export_pdf: true,
  brand_kits: true,
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    features: { ...NO_FEATURES, export_csv: true },
    limits: {
      audienceCap: 100,
      seats: 1,
      retentionDays: 365,
      auditRetentionDays: 30,
      aiDecksPerMonth: 5,
      importsPerMonth: 5,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    features: PAID_FEATURES,
    limits: {
      audienceCap: 1_000,
      seats: 1,
      retentionDays: 730,
      auditRetentionDays: 90,
      aiDecksPerMonth: 50,
      importsPerMonth: 50,
    },
  },
  team: {
    id: 'team',
    name: 'Team',
    features: PAID_FEATURES,
    limits: {
      audienceCap: 2_000,
      // Stripe-billed team workspaces use the purchased quantity (billing.seats).
      seats: 5,
      retentionDays: 1_095,
      auditRetentionDays: 365,
      aiDecksPerMonth: 200,
      importsPerMonth: 200,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    features: {
      export_csv: true,
      export_xlsx: true,
      export_pdf: true,
      brand_kits: true,
      sso: true,
      scim: true,
      custom_domains: true,
      white_label: true,
    },
    limits: {
      audienceCap: 10_000,
      seats: null,
      retentionDays: null,
      auditRetentionDays: 730,
      aiDecksPerMonth: null,
      importsPerMonth: null,
    },
  },
};

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);

/** Stored on Workspace.planOverrides; anything not listed falls back to the plan. */
export const planOverridesSchema = z
  .object({
    features: z.partialRecord(z.enum(FEATURES), z.boolean()).optional(),
    limits: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int().min(0).nullable()).optional(),
  })
  .strict();
export type PlanOverrides = z.infer<typeof planOverridesSchema>;
