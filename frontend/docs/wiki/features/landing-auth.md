---
summary: The landing page sections, header with mobile menu, sign-in pages and their shared shell, Privacy/Terms, the marketing tokens and what each claim on the page is backed by.
status: active
last_updated: 2026-10-19
---

# Landing and sign-in surfaces

Presentation only: no API, route or data-flow changes. Visual rules live in
[`../ui/design-system.md`](../ui/design-system.md) ("Marketing and auth surfaces").

## Landing (`app/page.tsx`, `features/landing/`)

`app/page.tsx` wraps everything in `MotionConfig reducedMotion="user"` and `.mk-surface`, adds a
skip link and renders, in order:

| Section | File | Notes |
| --- | --- | --- |
| Header | `components/hero/Navbar.tsx` | Anchors are absolute (`/#features`) so the same header works on Privacy/Terms. Below `lg` a menu button (`aria-expanded`, `aria-controls="mobile-nav"`, Escape closes and returns focus, scrim closes on click) replaces the links. Signed-out: Join a session, Log in (`/login`), Sign up free (`/signup`). Signed-in (after mount, so SSR matches): account menu + Dashboard. |
| Hero | `components/hero/Hero.tsx`, `LiveRoomPreview.tsx` | h1 "Slides your audience can answer". Primary CTA `/signup` (or `/polls` when signed in), secondary `/live`. The preview is a labelled "Sample session": bars fill once, then an answer lands every ~2 s; static for reduced motion; exposed as one `role="img"`. |
| Question types | `components/features/QuestionTypes.tsx` | The real slide types (`features/presentations/slides/types`) grouped by purpose. Replaced the fake "trusted by" logo marquee. |
| How it works | `components/features/Steps.tsx` | `ol` of three steps (a real sequence, so numbered). |
| Showcase | `components/features/ShowcaseSections.tsx`, `components/mockups/*` | Three alternating rows; `MockFrame` is the shared double-bezel illustration frame (sample content, one image to assistive tech). |
| Features | `components/features/Capabilities.tsx` | Eight capabilities in one bezel with hairline dividers. |
| Pricing | `components/pricing/Pricing.tsx` | Unchanged data flow: `usePlanCatalog()` (`/api/plans` with `FALLBACK_CATALOG`). A paid plan with no configured price reads "Pricing soon", Enterprise "Custom". "Contact sales" stays disabled without `NEXT_PUBLIC_SALES_EMAIL`, with a visible note. |
| FAQ | `components/faq/Faq.tsx` | Radix accordion (`type="single" collapsible`), questions are h3 buttons. Replaced the floating FAQ bubble. |
| Final CTA, footer | `components/cta/FinalCta.tsx`, `components/social/Footer.tsx` | Footer lists only real destinations (no placeholder `#` links, no social icons). |

Shared pieces: `components/shared/` (`BrandMark`, `SectionHeading`, `styles.ts` for gutters, section rhythm
and button recipes, `nav-links.ts`).

### What the copy is backed by

Every claim maps to something that exists: slide types (builder meta), AI outline review + speaker notes
(`ai-deck.md`), imports (`imports.md`), session reports, CSV on every plan and Excel/PDF on paid plans
(`sessions.md`, `billing.md`), roles and audit log (`workspaces.md`), Q&A and reactions (`qna.md`), quick
polls (`/create`, `/p/[id]`). No customer logos, testimonials, uptime or latency numbers: add them only
when they are real.

## Sign-in pages

`features/auth/components/AuthShell.tsx` is the frame for login, signup, forgot/reset password, verify
email and the invitation page: brand + theme switch on top, an h1, one double-bezel card, an optional
quiet footer line. `AuthStatus` renders the result states (sent, verified, expired, invalid).
`fields.tsx` has `AuthField`, `PasswordField` (show/hide toggle: `aria-label="Show password"` +
`aria-pressed`), `AuthSubmit`, `AuthDivider` and the shared field class (44px tall, `border-field-border`).

| Route | File |
| --- | --- |
| `/login`, `/signup` | `features/auth/components/LoginForm.tsx`, `SignupForm.tsx` |
| `/forgot-password`, `/reset-password/[token]`, `/verify-email/[token]` | `app/(auth)/**` |
| `/auth/complete` | `app/auth/complete/page.tsx` (loading state only) |
| `/invites/[token]` | `features/workspaces/invites/components/AcceptInvite.tsx` (only its `Shell` and class names changed) |
| `/privacy`, `/terms` | `app/privacy`, `app/terms` via `features/landing/components/legal/LegalPage.tsx` (header, footer, placeholder notice) |

Behaviour notes: errors still surface as toasts; the signup and reset hints state the API's real
password rule (8+ characters, one uppercase letter, one digit) and the reset page checks 8 instead of
the old 6. Playwright's `getByLabel("Password")` matches the toggle too, so specs use `{ exact: true }`.
The landing header's "Log in" goes to `/login` (the SSO button is on that page); it used to start the
SSO redirect directly.

## Tests

`e2e/landing-auth.spec.ts` (see `testing/e2e.md`). `e2e/members.spec.ts` and `e2e/billing.spec.ts` were
adjusted for the password toggle and the "Pricing soon" label.
