---
summary: Plan catalogue, entitlements (plan ⊕ overrides), requireFeature/assertLimit, monthly usage counters, set-plan script, and deployment capabilities.
status: active
last_updated: 2026-10-19
---

# Plans, entitlements, usage, capabilities (`common/plans/`)

Two separate questions:

- **Capabilities** — what this *deployment* can do (configured services). `env.capabilities`,
  served by `GET /api/capabilities`.
- **Entitlements** — what a *workspace's plan* allows. Enforced whether or not Stripe billing is
  configured; without billing, plans are set with `scripts/set-plan.ts`.

## Plan catalogue (`plans.ts`)

`null` = unlimited. Enterprise values are defaults for a contract to override.

| | free | pro | team | enterprise |
| --- | --- | --- | --- | --- |
| `audienceCap` | 100 | 1,000 | 2,000 | 10,000 |
| `seats` | 1 | 1 | 5 (or purchased `billing.seats`) | ∞ |
| `retentionDays` (max a workspace may choose) | 365 | 730 | 1,095 | ∞ |
| `auditRetentionDays` | 30 | 90 | 365 | 730 |
| `aiDecksPerMonth` (counter `ai_deck`) | 5 | 50 | 200 | ∞ |
| `importsPerMonth` (counter `import`) | 5 | 50 | 200 | ∞ |
| `export_csv` | ✓ | ✓ | ✓ | ✓ |
| `export_xlsx`, `export_pdf`, `brand_kits` | – | ✓ | ✓ | ✓ |
| `sso`, `scim`, `custom_domains`, `white_label` | – | – | – | ✓ |

Change numbers here only (W3-C owns tuning them). `planOverridesSchema` validates
`Workspace.planOverrides = { features?: {…: boolean}, limits?: {…: number|null} }`.

## Entitlements (`entitlements.ts`, `requireFeature.ts`)

```ts
getEntitlements(ws)            // { plan, features, limits } = plan defaults ⊕ billing.seats ⊕ planOverrides
hasFeature(ws, feature)
assertFeature(ws, feature)     // 403 { code: 'FEATURE_NOT_IN_PLAN', details: { feature, plan } }
assertLimit(ws, key, n)        // n = the count after the operation; 403 { code: 'PLAN_LIMIT_REACHED', details: { limit, max, plan } }
requireFeature(feature)        // route guard; mount after authenticate() + workspaceContext()
```

Unknown plan ids read as `free`; invalid `planOverrides` are logged and ignored.

## Usage counters (`usage.ts`)

```ts
consumeUsage(ws, 'ai_deck' | 'import', amount = 1)   // { counter, period, used, limit, remaining }
getUsage(ws, counter)
```

- Redis key `usage:{<workspaceId>}:<yyyymm>:<counter>` (UTC month, TTL 40 days), `INCRBY`; over
  the limit → `DECRBY` back and 403 `PLAN_LIMIT_REACHED` (nothing consumed).
- Every successful consumption is mirrored to `UsageCounter {workspaceId, period, counter,
  value}` (unique `{workspaceId, period, counter}`) with `$max`.
- A fresh Redis key (Redis lost it) resumes from the mirror. With Redis down, counting happens
  in Mongo (`$inc`) so limits still hold.

## Setting a plan by hand (`scripts/set-plan.ts`)

```sh
bun scripts/set-plan.ts <workspace-id|slug|owner-email> <free|pro|team|enterprise> \
  [--overrides '{"limits":{"audienceCap":5000}}' | --clear-overrides]
```

Sets `planSource: 'manual'` (billing sync must leave it alone), writes a
`workspace.plan.set` audit event (actor `system`) and prints the entitlements. An owner email
resolves to that user's personal workspace (provisioned if needed).

## Capabilities (`common/config/env.ts`, `GET /api/capabilities`)

Public, rate-limited (120/min/IP). Response `data`:

| Key | On when |
| --- | --- |
| `billing` | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| `storage` | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` |
| `samlSso`, `scim` | `ENCRYPTION_KEY` (SCIM users sign in through SSO) |
| `pptxHighFidelity` | `GOTENBERG_URL` |
| `googleDriveImport` | `GOOGLE_DRIVE_IMPORT_ENABLED=true` + `GOOGLE_DRIVE_API_KEY` + `GOOGLE_DRIVE_APP_ID` + Google OAuth |
| `customDomains` | `DOMAIN_PROVISIONER` = `vercel` (+ `DOMAIN_VERCEL_TOKEN`, `DOMAIN_VERCEL_PROJECT_ID`) or `caddy`, with `DOMAIN_CNAME_TARGET` |
| `metrics` | `METRICS_TOKEN` (≥16 chars) |
| `ai` | `LLM_BASE_URL` + `LLM_API_KEY`, or `GEMINI_API_KEY` (placeholders ignored) |

Each group is validated like the OIDC/Google ones: setting part of it makes the rest required
and boot fails listing every problem. Parsed settings live on `env.billing`, `env.storage`,
`env.encryptionKey`, `env.gotenbergUrl`, `env.googleDriveImport`, `env.domains`,
`env.metricsToken`. All variables are documented in `backend/.env.example`.
