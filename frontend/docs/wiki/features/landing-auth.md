---
summary: The landing page sections, header with mobile menu, sign-in pages and their shared shell, Privacy/Terms, and what each claim on the page is backed by.
status: active
last_updated: 2026-10-26
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
| Hero | `components/hero/Hero.tsx`, `LiveRoomPreview.tsx` | Left-aligned h1 "Slides your audience can answer." on graph paper (`.mk-grid`), "answer" in Instrument Serif italic `text-brand` (the only serif on the site). Copy left, pill CTAs right on `lg`: primary `/signup` (or `/polls` when signed in), secondary `/live`. The preview is a `figure`: the projected screen with the audience phone resting on its lower right corner (md+), following the app theme, labelled "Sample session", one `role="img"`, plus a caption. Answers are `ResultRow` cards (`components/shared/ResultRow.tsx`: the share fills the card, the leader is tinted, the percentage counts up, a "+1" pops where a vote lands); an answer lands every ~2 s (still for reduced motion). |
| Question types | `components/features/QuestionTypes.tsx`, `components/stage/scenes.tsx` | The real slide types (`features/presentations/slides/types`) as a tablist beside one dark stage (`role="tabpanel"`). Tabs are a scrolling chip row on phones and an index of rows on `lg` (the selected row shows its description and an ember rule). Arrow keys, Home and End move between tabs. The stage (a sheet following the app theme, the scene on graph paper) plays the selected type's sample result (one scene per type: answer cards fill, words grow, rows reorder, pins drop...). Autoplay moves on every 6.5s while the stage is on screen, pauses on hover/focus, has a pause button, and stops once a type is picked; none with reduced motion. Scenes mount after the stage is first seen. The 2 by 2 grid scene draws the product's own `GridBoard` (numbered averages, a dot per placement, named corners) as six sample participants answer. The word cloud scene streams 40 sample answers, one every 140 ms, into the product's own `WordCloud` (live mode: words keep their spot and grow there), with `--deck-cloud-*` remapped to the app's chart colours so the words hold contrast on the light and dark stage. |
| How it works | `components/features/Steps.tsx`, `StepArt.tsx` | `ol` of three steps (a real sequence): ink circles numbered 1-3 in mono on one rule that runs across the row on `lg` (picture above words there and on phones; picture beside words from `sm` to `lg`, where a full-width picture would stretch thin), each with a small illustration (pick a start and slides stack up; the join code appears and people join; the report's results link is copied). The one white (`card`) band on the page. |
| Showcase | `components/features/ShowcaseSections.tsx`, `components/mockups/*` | Three alternating rows (copy 5 columns, visual 7) with a hairline check list; each visual sits on a `PlotPanel` (graph paper) and `MockFrame` is the shared bordered illustration frame (sample content, one image to assistive tech). |
| Features | `components/features/Capabilities.tsx`, `CapabilityArt.tsx` | A bento in one bordered block: four featured cells (Q&A, AI drafts, import, reports; spans 7/5/5/7 on `lg`; full rows with the picture beside the words from `sm` to `lg`), then four compact cells (live decks, teams, privacy, quick polls; 3 each). Every cell has an illustration that plays once when half on screen. |
| Pricing | `components/pricing/Pricing.tsx` | Unchanged data flow: `usePlanCatalog()` (`/api/plans` with `FALLBACK_CATALOG`). The most popular plan is the one dark sheet (`dark` class on the card). A paid plan with no configured price reads "Pricing soon", Enterprise "Custom". "Contact sales" stays disabled without `NEXT_PUBLIC_SALES_EMAIL`, with a visible note. |
| FAQ | `components/faq/Faq.tsx`, `content.ts` | Radix accordion (`type="single" collapsible`, controlled), questions are h3 buttons, heading sticky beside it on `lg`. The questions and answers live in `features/landing/content.ts`, shared with the FAQ JSON-LD and `/llms.txt`. Closed answers stay in the HTML (`forceMount` + `hidden`) so crawlers that do not run scripts read them; opening animates, closing is instant. |
| Final CTA, footer | `components/cta/FinalCta.tsx`, `components/social/Footer.tsx` | The CTA ends on the hero's graph paper, heading left, pills right. The footer lists only real destinations, then the "Open Poll." wordmark sized to the column with container units (`24.6cqw`, `aria-hidden`), then the copyright and theme switch. |

Illustrations in the bento and the steps share `components/shared/ArtFrame.tsx`: graph paper, a "Sample"
badge, one `role="img"`, `size="lg" | "sm"` (256 / 176px), and the drawing rendered after mount (reduced
motion changes the first frame, so the server cannot render it). `artSheet` is the white sheet inside.

Shared pieces: `components/shared/` (`BrandMark`, `SectionHeading` with `layout="split" | "stack"`, `PlotPanel`, `ArtFrame`, `motion.tsx`,
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
| `/auth/complete` | `app/auth/complete/page.tsx` (loading state; then a remembered invitation, `/settings/privacy` or MCP consent request, else `/polls`) |
| `/invites/[token]` | `features/workspaces/invites/components/AcceptInvite.tsx` (only its `Shell` and class names changed) |
| `/oauth/consent` | `features/mcp/components/OAuthConsent.tsx`: an AI app's connection request (MCP OAuth); details in `workspaces.md` |
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
