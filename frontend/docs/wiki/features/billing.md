---
summary: The billing settings page (plan, usage, checkout, portal, disabled state), the landing pricing read from /api/plans, and the static fallback.
status: active
last_updated: 2026-10-19
---

# Billing (`features/billing/`)

Backend contract: `backend/docs/wiki/modules/billing.md`. Two surfaces share one catalogue
(`GET /api/plans`): the signed-in billing page and the public landing pricing.

## Files

| File | Role |
| --- | --- |
| `types.ts` | `PlanCatalog`, `CatalogPlan`, `BillingOverview`, `UsageMeter`, `CheckoutRequest`. |
| `api/billing.api.ts` | `getPlanCatalog`, `getBilling`, `startCheckout`, `openBillingPortal` (the last two return the Stripe URL). |
| `hooks/usePlanCatalog.ts` | `GET /api/plans` once per page load; `{ catalog, source: 'api' \| 'fallback' }`. |
| `hooks/useBilling.ts` | `GET /api/billing` for a workspace id (waits for the workspace so `X-Workspace-Id` is set); `reload`, quiet `refresh`. |
| `lib/format.ts` | `formatMoney` (minor units, currency-aware), `perMonth`, `yearlySavingsPercent`, `formatLimit`, `usagePercent`, `formatDate` (UTC). |
| `lib/catalog.ts` | `FALLBACK_CATALOG`, `planHighlights`, `pricingTiers`, `hasIntervalChoice`, `bestYearlySavings`. |
| `lib/status.ts` | `planStatusKey` / `isProblemStatus`: the one status line of a plan. |
| `components/BillingSettings.tsx` | Page content: loading, errors, owner-only note, disabled notice, checkout-return banner, then `PlanCard`, `UsageCard`, `UpgradePlans`. |
| `components/PlanCard.tsx` | Plan name, status badge, interval, renewal or end date, failed-payment alert, "Manage billing" (portal). |
| `components/UsageCard.tsx` | Meters for AI decks, imports and members, plus the participant cap. |
| `components/UpgradePlans.tsx` | Pro and Team cards, monthly/yearly toggle, Team seats input, "Choose X" → `POST /api/billing/checkout` → `window.location.assign(url)`. |
| `components/BillingIntlProvider.tsx` | next-intl provider (the dashboard has none); strings in `messages/en/billing.json`. |

`app/(dashboard)/settings/billing/page.tsx` renders `BillingSettings`. The landing
`features/landing/components/pricing/Pricing.tsx` reads `usePlanCatalog()`.

## Behaviour

- **Gates**: the settings nav entry is gated only by the `workspace:billing` permission (owner),
  not by the `billing` capability, so the page is reachable on servers without Stripe. The page
  checks the permission itself ("Only the workspace owner can manage billing.") and the API
  enforces it.
- **Billing off** (`overview.enabled === false`): a "Billing is not configured on this server"
  notice; the plan and usage still show (limits hold without Stripe); no checkout, no portal, no
  buttons that would do nothing.
- **Billing on**: `UpgradePlans` shows the paid plans with prices from the API (per month; per seat
  for Team; the yearly charge below) and enables a plan only when `overview.checkout[plan][interval]`
  says it can be sold. A workspace that already subscribed (portal instead) or has a hand-assigned
  plan sees why it cannot buy. Team asks for seats (at least the member count; the server also
  enforces it). A refused request (e.g. 503 `BILLING_DISABLED`) is shown as a toast and the button
  works again.
- **Returning from Stripe**: `?checkout=success` shows "activating" and re-reads `GET /api/billing`
  every 3 s (up to 10 times) until the webhook has changed the plan, then confirms; `?checkout=canceled`
  says nothing was charged. Stripe's `success_url` / `cancel_url` are built by the backend.
- **Landing pricing**: one card per plan from `/api/plans`. Bullets are computed from each plan's own
  limits and features (`planHighlights`), so changing `plans.ts` changes the page. A paid plan
  without a price shows "Custom"; the monthly/yearly toggle and the "N% off" badge appear only when a
  plan has both prices, and the percentage is computed from them. Free → `/signup`; Pro/Team →
  `/settings/billing`; "Contact sales" is a `mailto:` of `NEXT_PUBLIC_SALES_EMAIL`, disabled while
  that is unset. Until the API answers, and when it fails, `FALLBACK_CATALOG` is shown: limits and
  features mirroring `backend/src/common/plans/plans.ts`, never a price.

## Tests

`tests/unit/billing.lib.test.ts` (formatting, tiers, fallback numbers, status),
`tests/unit/billing.components.test.tsx` (static renders of the cards), `tests/unit/settings.sections.test.ts`
(billing gate); e2e `e2e/billing.spec.ts` (`testing/e2e.md`).
