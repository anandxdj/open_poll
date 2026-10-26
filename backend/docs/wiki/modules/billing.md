---
summary: Stripe billing (checkout, portal, signed webhook, seat sync), the public plan catalogue, the poll response cap, disabled mode, audit actions and the owner's Stripe setup.
status: active
last_updated: 2026-10-19
---

# Billing Module (`src/modules/billing/`)

Plans, entitlements and usage counters live in `common/plans/` (`platform/plans.md`) and hold
with or without Stripe. This module is the Stripe side: it sells a plan to a workspace and keeps
the workspace's `plan` in step with what Stripe says. **Without Stripe keys nothing is faked**:
checkout, portal and the webhook answer `503 BILLING_DISABLED`, `GET /api/capabilities`
reports `billing: false`, and plans are set by hand (`bun scripts/set-plan.ts`).

## Files

| File | Role |
| --- | --- |
| `billing.route.ts` | `billingRouter` (`/api/billing`), `billingWebhookRouter` (`/api/billing/webhook`, raw body), `plansRouter` (`/api/plans`). |
| `billing.controller.ts`, `billing.schema.ts` | HTTP glue, audit events; the strict checkout body. |
| `billing.service.ts` | `getBillingOverview`, `createCheckoutSession`, `createPortalSession`, `checkoutBlock`. |
| `plansCatalog.ts` | `getPlanCatalog` (limits and features from `plans.ts`, prices from Stripe, cached 10 min). |
| `stripe.ts` | Billing runtime (`getBillingRuntime`, `requireBilling`, `setBillingRuntime` for tests), `BILLING_DISABLED`. |
| `prices.ts` | `STRIPE_PRICE_{PRO,TEAM}_{MONTHLY,YEARLY}` ↔ plan and interval. |
| `subscriptionState.ts` | Pure rules: Stripe subscription → workspace plan and billing fields. |
| `subscriptionSync.ts` | Applies a subscription's *current* state to its workspace under a Redis lock. |
| `webhook.service.ts` | Signature check, exactly-once claiming (`StripeEvent`), the six handlers. |
| `stripeEvent.model.ts` | `StripeEvent` (`_id` = event id, TTL 90 days); index from migration `120-stripe-events`. |
| `seatSync.ts` | `billing-seat-sync` job. |
| `pollCap.ts` | Per-poll response cap (`audienceCap`), used by `responses.service.ts`. |

## API

| Method + path | Auth | `data` |
| --- | --- | --- |
| `GET /api/plans` | public, 120/min/IP, `Cache-Control: public, max-age=60` | `{ billingEnabled, plans: [{ id, name, limits, features, perSeat, prices, checkout }] }` |
| `GET /api/billing` | `workspace:billing` (owner), current workspace (`X-Workspace-Id`), 60/min/user | `BillingOverview` |
| `POST /api/billing/checkout` `{ plan: 'pro'\|'team', interval: 'monthly'\|'yearly', seats? }` | owner, 30/hour/user | `{ url }` (Stripe Checkout) |
| `POST /api/billing/portal` | owner, 30/hour/user | `{ url }` (Stripe Billing Portal) |
| `POST /api/billing/webhook` | Stripe signature, 600/min/IP | `{ received: true, outcome }` |

`prices` is `null` for Free, Enterprise and when billing is off. For Pro and Team it is
`{ monthly, yearly }`, each `{ amount, currency }` (minor units of one billing period) or `null`
when that price id is not configured, not an active per-unit recurring price of that interval,
or Stripe could not be read (retried after 1 min). `checkout` says whether checkout can sell the
plan at each interval. Amounts are never invented: the landing page shows "Custom" without them.

`BillingOverview`: `enabled`, `workspace`, `plan`, `planSource` (`default|stripe|manual`),
`status` (Stripe), `subscription` (`{plan, interval}` from the price), `currentPeriodEnd`,
`cancelAtPeriodEnd`, `paymentFailed` (`past_due`), `seats {used, limit, purchased}`,
`usage[]` (`ai_deck`, `import`: `used`, `limit`, `remaining`, `period`), `entitlements`,
`canOpenPortal`, `checkout` (plan → interval → bool) and `checkoutBlockedReason`
(`already_subscribed|plan_managed_manually|null`).

### Checkout and portal

- Authorization (`assertCan 'workspace:billing'`) runs before the disabled check, so a non-owner
  gets 403 whatever the configuration. Then `503 BILLING_DISABLED` when `STRIPE_SECRET_KEY` /
  `STRIPE_WEBHOOK_SECRET` are missing, or (checkout) when the price id for that plan and
  interval is not set (`details.reason: 'price_not_configured'`).
- `409 PLAN_MANAGED_MANUALLY` (planSource `manual`) and `409 ALREADY_SUBSCRIBED` (a Stripe
  subscription in `active|trialing|past_due`) refuse a second purchase: change it in the portal.
  A subscription that ended (canceled, unpaid, ...) can be bought again.
- One Stripe customer per workspace, created on first checkout with an idempotency key
  (`openpoll-customer-<workspaceId>`) and stored with a conditional update (loser of a race adopts
  the winner's customer). `Workspace.billing.stripeCustomerId` is unique.
- The session is `mode: 'subscription'` with `client_reference_id`, `metadata` and
  `subscription_data.metadata` = the workspace id (the webhook's link back), promotion codes
  allowed, and `success_url`/`cancel_url` = `FRONTEND_URL/settings/billing?checkout=success|canceled`
  (never client-supplied). Idempotency key per workspace, price, quantity and 5-minute window:
  a double click reuses the session.
- Team is per seat: quantity = max(active members, requested `seats`, 1), with
  `adjustable_quantity` (min = active members, max 1000) so the buyer can also change it on
  Stripe's page. Pro is quantity 1; `seats` is ignored.
- `STRIPE_AUTOMATIC_TAX=true` adds `automatic_tax`, a required billing address and tax-id
  collection (Stripe Tax must be set up).
- `409 NO_BILLING_ACCOUNT` for the portal before the workspace ever had a customer.
- A Stripe failure is logged and answered `502 BILLING_PROVIDER_ERROR` without Stripe's text.

## Webhook (`POST /api/billing/webhook`)

Mounted before CORS and the JSON parsers behind `express.raw`, so `req.body` is the exact signed
Buffer (`http/app-and-routes.md`). `stripe.webhooks.constructEventAsync` (Bun resolves Stripe's
SubtleCrypto build: the sync `constructEvent` throws) verifies `Stripe-Signature` against
`STRIPE_WEBHOOK_SECRET`; a missing, malformed, wrong or stale signature or a non-raw body is
`400` and nothing runs.

Handled events (configure the endpoint with exactly these): `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Any other type is
acknowledged (200, `outcome: 'ignored'`) without a record.

### Exactly once

`StripeEvent` `_id` = Stripe event id, inserted (`status: 'processing'`, a 2-minute lease) **before**
any side effect, so the insert is the atomic claim. Outcomes:

| Situation | Answer |
| --- | --- |
| first delivery, handler succeeds | 200 `processed` (record `processed`) |
| replay of a processed event | 200 `duplicate`, handler not run |
| another delivery holds it (lease not over) | 409 `WEBHOOK_IN_PROGRESS`: Stripe retries |
| handler throws | record `failed`, response 500: Stripe retries; the retry takes the event over atomically (`attempts` counts) |
| worker crashed (lease over) | the next delivery takes it over |

Records expire 90 days after creation (TTL index).

### Out-of-order and duplicate events

Handlers never trust the event's copy of the subscription. Each one calls `syncSubscription`,
which **retrieves the subscription from Stripe** (the event copy is only a fallback when Stripe
no longer has it) and applies that current state under a per-subscription Redis lock
(`billing:{<subscriptionId>}:lock`). So a late `created` after `deleted`, or a replayed `updated`,
converges on Stripe's present state. Rules (`subscriptionState.ts`):

- Subscription → workspace: the one holding the customer id (`billing.stripeCustomerId`), else
  the workspace named by checkout/metadata, provided it has no *other* customer.
- `active`, `trialing`, `past_due` (Stripe is still retrying) on a known price → that plan,
  `planSource: 'stripe'`, `billing.seats` = quantity for Team (null for Pro).
- Any other status (`canceled`, `unpaid`, `incomplete*`, `paused`) → Free, `planSource: 'default'`,
  seats cleared. Deleting the subscription downgrades.
- A subscription other than the workspace's current one only takes over when it is entitled:
  late events of an old, ended subscription never downgrade the workspace. If both are entitled
  (two checkouts completed), the new one wins, an error is logged and
  `billing.subscription.replaced` is audited: cancel the extra one in Stripe.
- An entitled subscription on a price no `STRIPE_PRICE_*` names leaves the plan alone (logged).
- **`planSource: 'manual'` is never overwritten** (set by `scripts/set-plan.ts`: enterprise
  contracts, support grants). The billing fields are still recorded, and the write is
  conditional (`planSource != 'manual'`), so a plan pinned between the read and the write is
  also safe. Checkout refuses such workspaces.

## Seat sync (`billing-seat-sync`, every 15 min via `registerJob`)

Team seats are purchased capacity: bought at checkout, changed in the portal, recorded by the
webhook as `billing.seats`, which becomes the plan's `seats` limit (`getEntitlements`), so
W3-B1's invite check (`assertLimit(ws, 'seats', n)`) holds. The job covers the gap: when active
members exceed the subscription quantity (SCIM, SSO just-in-time, a lowered quantity) it raises
the quantity to the member count (`proration_behavior: create_prorations`, idempotency key per
change) and re-syncs. **It never lowers**: unused seats are capacity the owner chose and removes
in the portal. No-op without billing; only `planSource: 'stripe'` Team workspaces with an
entitled subscription. `syncWorkspaceSeats(runtime, workspace)` is exported for packages that add
members outside the invite flow.

## Poll response cap (`pollCap.ts`)

A poll accepts at most the workspace plan's `audienceCap` responses (Free 100, Pro 1,000, Team
2,000, Enterprise 10,000, or the workspace's override). `ResponseService.submitResponse`
(`responses.service.ts`) calls `openPollResponseGate(poll)` after the ballot is verified and
before anything is spent: a full poll answers `403 PLAN_LIMIT_REACHED`
(`details: { limit: 'audienceCap', max, plan }`) and the voter's ballot and identity markers are
untouched, so an upgrade lifts the cap for people who were turned away. `reserve()` then takes
a slot atomically (Redis `INCR`, released if the submission fails) after the dedup claims.
Counter key `poll:<id>:responseCount`, expiring a week after the poll; a missing key restarts
from the stored responses. Trial attempts count (the cap is on submissions). Polls without a
workspace (before migration 020) are not capped.

## Audit actions

`billing.checkout.start`, `billing.portal.open` (user, with IP/UA), `billing.plan.change`,
`billing.subscription.update` (status change), `billing.subscription.replaced`,
`billing.payment.failed`, `billing.seats.raise` (system).

## Plan gates other packages must apply

`requireFeature(feature)` (route guard, after `authenticate()` + `workspaceContext()`) /
`assertFeature(ws, feature)` exist and are tested; nothing in the app calls them yet. Free has
`export_csv` only; Pro and Team add `export_xlsx`, `export_pdf`, `brand_kits`; only Enterprise has
the rest.

| Gate | Where | Package |
| --- | --- | --- |
| `export_xlsx`, `export_pdf` (CSV stays free) | session/poll export routes | W2-C |
| `brand_kits` | every `/api/brand-kits` route; applying a kit to a deck or the workspace default | W3-A (done) |
| `sso`, `scim` | SSO connection and SCIM token management (not the login itself) | W3-D |
| `custom_domains`, `white_label` | domain routes; removing "Powered by Open Poll" | W4-E |
| `consumeUsage(ws, 'ai_deck')` | `POST /api/ai/generate-deck` | W3-F |
| `consumeUsage(ws, 'import')` | `POST /api/imports` | W3-E |
| `assertLimit(ws, 'seats', n)` | invites, SCIM/SSO JIT (or rely on seat sync for JIT) | W3-B1, W3-D |
| `assertLimit(ws, 'retentionDays', d)` | `WorkspaceService.update`; sessions are purged at `retainUntil` by `privacy-retention-purge` | W4-C (done) |

Already enforced: `audienceCap` in live sessions (W1-A1) and on poll responses (here),
`auditRetentionDays` in `audit()`, `retentionDays` on workspace settings, team-workspace
creation gate in `workspaces.service.ts`.

## Owner setup (Stripe)

1. **Products and prices** (Dashboard → Product catalogue): two products, "Pro" and "Team", each
   with a monthly and a yearly recurring price (four prices). Team prices are *per unit*
   (licensed quantity = seats); no tiered or metered prices. Set the currency; the landing page
   and billing page read amounts from these prices.
2. **API key**: a secret or restricted key (Customers, Checkout Sessions, Billing portal
   sessions, Subscriptions: write; Prices: read) → `STRIPE_SECRET_KEY`.
3. **Webhook endpoint**: `https://<backend-host>/api/billing/webhook`, events exactly:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Its signing secret →
   `STRIPE_WEBHOOK_SECRET`. Locally: `stripe listen --forward-to localhost:5000/api/billing/webhook`
   prints a `whsec_…` for the same variable.
4. **Price ids** → `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_TEAM_MONTHLY`,
   `STRIPE_PRICE_TEAM_YEARLY`. Billing turns on with the key and webhook secret; a plan whose
   price id is missing cannot be bought (checkout 503).
5. **Customer Portal** (Settings → Billing → Customer portal): enable payment-method updates,
   invoice history, cancellation, and subscription updates (allow switching between the Pro and
   Team prices and updating the Team quantity). The app sets the return URL per session.
6. **Tax** (optional): enable Stripe Tax, give the products a tax code, set
   `STRIPE_AUTOMATIC_TAX=true`.
7. `FRONTEND_URL` must be the public frontend URL (Checkout and portal return there).
8. Deploy runs `bun run migrate` (migration 120 creates the `StripeEvent` TTL index) and needs
   Redis (locks) and a long-lived process (the seat sync job).
9. Decide what happens at the end: a canceled or unpaid subscription downgrades the workspace to
   Free at once (data is kept; limits apply). Workspaces over the Free seat or response limits
   keep what they have and cannot add more.

## Tests

`tests/billing.{state,webhook,service,pollCap}.test.ts` (unit, fixtures in
`tests/fixtures/stripe/`), `tests/integration/billing.http.test.ts` (real Mongo/Redis through
the app: plans, overview, disabled mode, checkout, signed webhook, replay, concurrency,
out-of-order, retry, seat sync, response cap), `tests/spikes/stripe.test.ts` (SDK under Bun),
frontend `tests/unit/billing.*` and `e2e/billing.spec.ts`.
