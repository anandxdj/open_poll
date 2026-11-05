---
summary: The landing page sections, header with mobile menu, sign-in pages and their shared shell, Privacy/Terms, and what each claim on the page is backed by.
status: active
last_updated: 2026-10-27
---

# Landing and sign-in surfaces

Presentation only: no API, route or data-flow changes. Visual rules, tokens and primitives are in
[`../ui/design-system.md`](../ui/design-system.md).

## Landing (`app/page.tsx`, `features/landing/`)

`app/page.tsx` is a server component: it sets the page metadata, renders the landing JSON-LD (see
`seo.md`) and `LandingPage` (`components/LandingPage.tsx`, client), which wraps everything in
`MotionConfig reducedMotion="user"` and `.mk-surface`, adds a skip link and renders, in order:

| Section | File | Notes |
| --- | --- | --- |
| Header | `components/hero/Navbar.tsx` | Anchors are absolute (`/#features`) so the same header works on Privacy/Terms. Below `lg` a menu button (`aria-expanded`, `aria-controls="mobile-nav"`, Escape closes and returns focus, scrim closes on click) replaces the links. Signed-out: Join a session, Log in (`/login`), Sign up free (`/signup`). Signed-in (after mount, so SSR matches): account menu + Dashboard. |
| Hero | `components/hero/Hero.tsx`, `LiveRoomPreview.tsx` | Left-aligned h1 "Slides your audience can answer." on graph paper (`.mk-grid`), "answer" in Instrument Serif italic `text-brand` (the only serif on the site). Copy left, pill CTAs right on `lg`: primary `/signup` (or `/polls` when signed in), secondary `/live`. The preview is the projected screen with the audience phone resting on its lower right corner (md+), following the app theme, labelled "Sample session" (the one "Sample" badge on the page), one `role="img"`. Answers are `ResultRow` cards (`components/shared/ResultRow.tsx`: the share fills the card, the leader is tinted, the percentage counts up, a "+1" pops where a vote lands); an answer lands every ~2 s (still for reduced motion). |
| Question types | `components/features/QuestionTypes.tsx`, `components/stage/scenes.tsx` | Five of the real slide types (`features/presentations/slides/types`): multiple choice, word cloud, pin on image, Q&A and leaderboard, as a tablist beside one dark stage (`role="tabpanel"`). One line under the tabs (beside the stage on `lg`, the stage spans both grid rows) names the other seven, so the page still lists every type. Tabs are a scrolling chip row on phones and an index of rows on `lg` (the selected row shows its description and an ember rule). Arrow keys, Home and End move between tabs. The stage (a sheet following the app theme, the scene on graph paper) plays the selected type's sample result (one scene per type: answer cards fill, words grow, rows reorder, pins drop...). Autoplay moves on every 6.5s while the stage is on screen, pauses on hover/focus, has a pause button, and stops once a type is picked; none with reduced motion. Scenes mount after the stage is first seen. The word cloud scene streams 40 sample answers, one every 140 ms, into the product's own `WordCloud` (live mode: words keep their spot and grow there), with `--deck-cloud-*` remapped to the app's chart colours so the words hold contrast on the light and dark stage. |
| How it works | `components/features/Steps.tsx`, `components/mockups/*` | `ol` of three steps (a real sequence: build or import with AI, go live with a join code, watch answers and Q&A arrive) as alternating rows (copy 5 columns, visual 7 on `lg`; picture under the words below `lg`). Each row opens with an ink circle numbered in mono; each visual sits on a `PlotPanel` (graph paper) and `MockFrame` is the shared bordered illustration frame (sample content, one image to assistive tech). The one white (`card`) band on the page. |
| Features | `components/features/Capabilities.tsx` | Only what the sections above don't already show: import, reports and exports, teams and roles, quick polls by link. Four plain cells (icon, h3, sentence) in one bordered block, 1/2/4 columns. |
| Pricing | `components/pricing/Pricing.tsx` | Unchanged data flow: `usePlanCatalog()` (`/api/plans` with `FALLBACK_CATALOG`). The most popular plan is the one dark sheet (`dark` class on the card). A paid plan with no configured price reads "Pricing soon", Enterprise "Custom". "Contact sales" stays disabled without `NEXT_PUBLIC_SALES_EMAIL`, with a visible note. |
| FAQ | `components/faq/Faq.tsx`, `content.ts` | Radix accordion (`type="single" collapsible`, controlled), questions are h3 buttons, heading sticky beside it on `lg`. The questions and answers live in `features/landing/content.ts`, shared with the FAQ JSON-LD and `/llms.txt`. Closed answers stay in the HTML (`forceMount` + `hidden`) so crawlers that do not run scripts read them; opening animates, closing is instant. |
| Final CTA, footer | `components/cta/FinalCta.tsx`, `components/social/Footer.tsx` | The CTA ends on the hero's graph paper, heading left, pills right. The footer lists only real destinations, then the "Open Poll." wordmark sized to the column with container units (`24.6cqw`, `aria-hidden`), then the copyright and theme switch. |

Each fact is told once: joining without an account lives in the hero and step 2, AI drafting in step 1,
the slide types in their own section, plans in pricing. The FAQ keeps only questions the sections don't
answer (account, import, team, results); add a section or a FAQ entry, not both.

Shared pieces: `components/shared/` (`BrandMark`, `SectionHeading` with `layout="split" | "stack"`, `PlotPanel`, `motion.tsx`,
`styles.ts` for gutters, section rhythm, `linkButton` and `pill`, `nav-links.ts`). The header's links and
buttons are pills; it turns solid paper with a blur once the page scrolls.

### What the copy is backed by

Every claim maps to something that exists: slide types (builder meta), AI outline review + speaker notes
(`ai-deck.md`), imports (`imports.md`), session reports, CSV on every plan and Excel/PDF on paid plans
(`sessions.md`, `billing.md`), roles and audit log (`workspaces.md`), Q&A and reactions (`qna.md`), quick
polls (`/create`, `/p/[id]`). No customer logos, testimonials, uptime or latency numbers: add them only
when they are real.

## Sign-in pages

`features/auth/components/AuthShell.tsx` is the frame for login, signup, forgot/reset password, verify
email and the invitation page: brand + theme switch on top, a narrow column with an h1 (and an optional
status icon), Privacy/Terms underneath, and on `lg` the product panel `AuthAside.tsx` (a static sample session and three
real selling points on flat graph paper; off for verify email and invitations via `aside={false}`).
`fields.tsx` has `AuthField`, `PasswordField` (show/hide toggle: `aria-label="Show password"` +
`aria-pressed`), `AuthSubmit`, `AuthDivider` and the field height (44px on phones, 40px from `md`).
Result states (sent, verified, expired, invalid) are the same shell with `icon` + `tone` and a new h1.

| Route | File |
| --- | --- |
| `/login`, `/signup` | `features/auth/components/LoginForm.tsx`, `SignupForm.tsx` |
| `/forgot-password`, `/reset-password/[token]`, `/verify-email/[token]` | `app/(auth)/**` |
| `/auth/complete` | `app/auth/complete/page.tsx` (loading state; then a remembered invitation or `/settings/privacy`, else `/polls`) |
| `/invites/[token]` | `features/workspaces/invites/components/AcceptInvite.tsx` (only its `Shell` and class names changed) |
| `/privacy`, `/terms` | `app/privacy`, `app/terms` via `features/landing/components/legal/LegalPage.tsx` (header, footer, placeholder notice). `/privacy` keeps the owner's placeholder paragraph and adds what the product does with data (export, account deletion, participants removing their answers, retention), which stays accurate as written. |

Behaviour notes: errors still surface as toasts; the signup and reset hints state the API's real
password rule (8+ characters, one uppercase letter, one digit) and the reset page checks 8 instead of
the old 6. Playwright's `getByLabel("Password")` matches the toggle too, so specs use `{ exact: true }`.
The landing header's "Log in" goes to `/login` (the SSO button is on that page); it used to start the
SSO redirect directly. `/login?deleted=<date>` (after deleting an account) shows a note above the form
saying when the account goes; a sign-in that cancels a pending deletion (`restored` in the response)
toasts "Welcome back. Your account will not be deleted." "Continue with SSO" opens a work-email field
(`features/sso/components/SsoDiscovery.tsx`): a workspace connection for the email's verified domain wins,
else the deployment-wide OIDC sign-in as before. `?error=sso_*` codes from workspace SSO have their own
messages in `LoginForm`.

## Tests

`e2e/landing-auth.spec.ts` (see `testing/e2e.md`). `e2e/members.spec.ts` and `e2e/billing.spec.ts` were
adjusted for the password toggle and the "Pricing soon" label.
