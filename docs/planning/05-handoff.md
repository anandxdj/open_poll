---
summary: State of the backlog + roadmap work on branch chore/backlog-and-roadmap, and what is left.
status: active
last_updated: 2026-10-19
---

# Handoff — backlog and roadmap work

All work is on the local branch **`chore/backlog-and-roadmap`** (210+ commits ahead of `main`,
**not pushed**). Plan of record: [`04-implementation-plan.md`](./04-implementation-plan.md)
(waves, packages, file ownership, contracts). Security status:
[`02-security-hardening.md`](./02-security-hardening.md).

## Done (merged on the branch)

**Cleanup.** Untracked `.kimchi/`, `backend/scratch/`, `frontend/scratch/`, `frontend/package-lock.json`
(gitignored now); deleted merged remote branches; README setup/deploy drift fixed;
`frontend/.env.example` added.

**Security (Epic 0).**
- Vote integrity restored after the `5e63f87` regression: signed single-use ballots, atomic
  `SET NX` dedup, identity only from session or signed guest token (`responses.security.test.ts`).
- Auth: no self-registration as admin; OIDC/Google pre-hijack fix; provider identities in
  `User.identities[]`; Google `state`; Origin check for cookie endpoints; Bearer-only middleware;
  uniform register/forgot/resend responses; identity-keyed, fail-mode-aware rate limiter;
  central env validation (`common/config/env.ts`); hash-only email verification; CORS from
  `env.allowedOrigins`; frontend OAuth landing moved to `/auth/complete`.
- AI routes require auth + rate limit; REST rejects ungradeable published assessments.
- HTTP: 413 / 400 / 403 for oversized body, bad JSON, CORS reject.

**Engineering.** CI (`.github/workflows/ci.yml`): backend typecheck + unit, backend integration
(Mongo + Redis services), frontend typecheck + lint + unit + build, Playwright e2e. Frontend lint
0 errors. Dead `quizzes` backend/frontend modules removed (old URLs 308-redirect).

**Wave 0 (extension points).** W0-T app factory (`http/createApp.ts`, `http/routes.ts` mount
table with stubs for every future module, special mounts for Stripe/SAML/SCIM/metrics), all
planned backend deps installed + spike-tested under Bun, integration harness; W0-B realtime
envelope (`publishLiveEvent`, `live:event`, `live:join`, rooms, seq, legacy dual-emit); W0-D
platform (workspaces/roles/`assertCan`, `workspaceContext()`, plans/entitlements/usage,
scheduler, S3 storage via `Bun.S3Client`, uploads, capabilities, audit, crypto, migrations
runner + `bun run migrate`); W0-A backend slide registry + presentations module split (golden
tests); W0-C1 frontend live store/slots/slide runtime/deck theme/next-intl + Playwright; W0-C2
builder + editor registry + inspector tabs, `middleware.ts` → `proxy.ts`, security headers,
dashboard layout.

**Wave 1.** W1-A1 session engine (sessions kept per run, goto both ways, close/reopen, reveal
stops answers, untimed slides, audience cap, reconciliation, migration 030); W1-B workspaces API +
switcher + gated settings nav + polls tenancy + migration 020; W1-C unified library
(`/api/library`, convert poll → deck, migrations 010/011); W1-D eight content slide types +
image/video media (workspace check on deck create/update).

**Wave 1 (late).** Multi-select and ungraded `select_answer` in builder and live views (merged,
`fbfc71a`; commit `abaa8e8`).

**Wave 3 — W3-F AI whole-deck authoring** (merged early, ahead of the plan's Wave 3 order, because it
is independent). `POST /api/ai/generate-deck` (auth, shared `ai` limiter 20/5 min, workspace
context, `deck:create`) in two steps: `step:"outline"` (200, nothing stored, no usage) and
`step:"deck"` (201, creates the draft deck with speaker notes in the caller's workspace). Response
`{step, presentation, outline, warnings[], source:'llm'|'mock', usage}`. Each slide goes through a
per-slide mapper + registry `safeParse`; one targeted re-prompt per invalid slide (at most 10 per
deck), otherwise the slide is dropped with a warning; 502 `AI_DECK_EMPTY` when nothing valid
remains. A provider failure is a 502, never a silent mock. `ai_deck` usage is consumed only after the
deck is stored. Frontend: `AiPresentationModal` tabs "Whole deck" / "Quick slides", outline
review/edit, the result opens in the builder through `useDeckBuilder.handleDeckCreated`; mock mode is
labelled "Generated with mock data (no AI key configured)". Code: `backend/src/modules/ai/deck/**`,
`frontend/features/ai/deck/**`; wiki `backend/docs/wiki/modules/ai.md`,
`frontend/docs/wiki/features/ai-deck.md`. Light touches outside its ownership: `ai.service.ts`
(`hasModel` and `invokeStructured` are public now), `ai.route.ts` route line,
`tests/http.routes.snapshot.txt`, `tests/ai.routes.test.ts`, `frontend/i18n/messages.ts` (`ai`
namespace), small hunks in `useDeckBuilder.ts`, `PresentationBuilder.tsx`, `AiPresentationModal.tsx`.

**Wave 2 — W2-D phase 1, scale and reliability (backend)** (merged; `pkg/w2-d`, 8 commits). Merged
before W1-A2 (plan order was A2 → D) because it was ready first and is backend-only; W1-A2 then
adapted its client to it.
- Answer path: JS grading + one `EVALSHA live/lua/answer.lua` (window/grace, token + kicked checks,
  per-participant rate limit 30/10 s, dedup, generic RedisOps, scores, results, dirty mark).
  Idempotent replay by `clientAnswerId` (`replay:true`); other repeats 409 `ALREADY_ANSWERED`; `via`
  stored. `POST /answer` response is richer (`accepted, replay, slideId, slideIndex,
  clientAnswerId, via, answeredAt`).
- HMAC slide tickets (`st1.`) sent in `question:started` and `live-state.current.slideTicket`; timed
  slides accept until `endsAt`+15 s with a valid ticket unless closed/revealed; scored timed slides
  auto-reveal 1.5 s after the timer (instance poller on ZSET `live:autoreveal`).
- Socket `answer:submit` (the socket must have joined as that participant, else 403 `NOT_JOINED`) and
  `live:resync`. Coalescer `SET psess:{sid}:dirty NX PX 250` → one host `answer:received` per dirty
  slide per 250 ms; flushed before close/reveal/move/end; the 2 s worker is gone. Mongo write-behind
  in 50 ms batches (an instance crash can lose up to 50 ms of queued writes; `end` restores from
  Redis). Score double-add race at `end` fixed (`scoreFinalAt`).
- `SOCKET_REDIS_ADAPTER=on` adapter; `/metrics` (404 without `METRICS_TOKEN`, 401 on a bad bearer,
  rate limited); the analytics worker no longer uses `KEYS`; `backend/loadtest/*`, CI job
  `loadtest-smoke` (500/s, p95 150 ms, tunable with repo vars `STORM_MIN_RPS` / `STORM_MAX_P95_MS`),
  nightly workflow `loadtest-nightly.yml`. Local numbers: REST 600/s p95 5.6 ms; REST 2k/s p95
  16.9 ms; socket 2k/s p95 8.8 ms.
- Phase 2 (not started): see "Left to do".

**Wave 2 — W2-C session history, reports, export, share, take-home** (merged; `pkg/w2-c`, 8 commits).
- Backend `modules/sessions`: `GET /api/sessions?presentationId&cursor&limit`, `GET /api/sessions/:sid`
  (report; ended → `slideStats`, live → Redis aggregates), `GET /api/sessions/:sid/export.{csv,xlsx,pdf}`
  (CSV free; XLSX/PDF `requireFeature` → 403 `FEATURE_NOT_IN_PLAN`; registry-driven columns;
  formula-injection safe; audited), `POST|DELETE /api/sessions/:sid/share` (192-bit token,
  `includeNames`, `expiresAt`, `rotate`; ended sessions only, else 409 `SESSION_LIVE`), public
  `GET /api/public/results/:token` (300/min/IP, noindex, aggregates only), `DELETE /api/sessions/:sid`
  (policy `deck:delete`; removes participants, answers, Redis keys, Q&A rows if present; audited),
  `GET /api/sessions/:sid/me?participantId&token` (take-home). Ties ranked by score → final
  leaderboard order → join order everywhere.
- Frontend: `/presentations/[id]/sessions`, `/presentations/[id]/sessions/[sessionId]` (StageView
  `mode="report"`, live refresh 5 s, plan-gated export, share dialog, delete), `/r/[token]`,
  `/live/[code]/summary`; `endScreen` slot links; library menu "Session history".

**Wave 3 — W3-C billing and plan gates** (merged; `pkg/w3-c`, 9 commits).
- `GET /api/plans` (public, 120/min, prices only for configured Stripe price ids), `GET /api/billing`
  (`workspace:billing`), `POST /api/billing/checkout {plan, interval, seats?}` and
  `POST /api/billing/portal` (503 `BILLING_DISABLED` without keys/price id; 409
  `ALREADY_SUBSCRIBED` / `PLAN_MANAGED_MANUALLY` / `NO_BILLING_ACCOUNT`; Stripe errors → 502),
  webhook (raw body, `constructEventAsync`, atomic StripeEvent claim, replay 200 `duplicate`,
  concurrent 409, failure 500 + retry takeover, 2-min lease; re-reads the subscription under a
  per-subscription Redis lock; never overwrites `planSource:'manual'`), job `billing-seat-sync`
  (15 min, raises Team quantity only), migration `120-stripe-events` (TTL 90 d), poll response cap =
  plan `audienceCap` (403 `PLAN_LIMIT_REACHED`, Redis counter rebuilt from stored responses; polls
  without a workspace uncapped). Frontend `/settings/billing` (disabled state, checkout/portal,
  post-checkout polling) and landing `Pricing.tsx` fed by `/api/plans` with a static fallback. The
  Billing nav entry is no longer capability-gated (owner gate kept).
- Likely merge conflicts: `backend/tests/http.routes.snapshot.txt`,
  `frontend/features/workspaces/settings/sections.ts` + `tests/unit/settings.sections.test.ts`,
  `frontend/i18n/messages.ts`, `.env.example` files.
- After merging #2 and #3, verify that W2-C's export gating uses the same feature keys
  (`export_xlsx`, `export_pdf`) as `common/plans/plans.ts`; fix with a small commit if not.
- Known risk: `/api/auth/login` allows 10 logins per 5 min per IP and the whole e2e suite shares it.
  If e2e starts failing on login rate limits as specs accumulate, fix it properly (log in once per
  worker and reuse `storageState`, or have the e2e backend env set a higher limit through an
  existing env knob). Never disable rate limiting in production code paths.

**Wave 1 — W1-A2 session-aware live UI** (merged; `pkg/w1-a2`). The client speaks `live:join` /
`live:event` only (sessionId filter, seq tracking; the host resyncs on a seq gap at most once per
second, participants on reconnect, seq reset and tab focus). The host reads `GET /:id/host/state` on
mount and chooses Start presenting / Open lobby / Present again (no auto-opened lobby; content-only
decks start without one); goto back/forward shows stored results; Close voting / Reopen / Reveal;
mid-run End Session; the host re-reads state on `question:started` / `slide:closed`. Participants
keep per-session credentials (`openpoll_participant_{code}_{sessionId}`) with rejoin and error codes.
Per-event server clock offset (the countdown bug is fixed, unit-tested). Strings in `presenter.json` /
`live.json`. The slots and a single `submitAnswer` are adapted to W2-D phase 1 (fresh `clientAnswerId`,
`slideTicket`, retries on transient errors, error-code toasts). The store exposes `sessionId` for W2-C's
endScreen link. The e2e host fixture logs in once per worker (fixes the login 429 as the suite grows).
Deleted unused `api/presentationApi.ts`. Specs: `e2e/live-session.spec.ts`.

**Wave 2 — W2-E advanced question types** (merged; `pkg/w2-e`). Four registry types, backend
(`slides/types/advanced/*`: schema, grading, results, sanitizing) and frontend (builder editor, stage,
participant view each): `guess_number` (graded within a tolerance, flat points, histogram), `hundred_points`
(split 100 points over items, overshoot guard), `grid_2x2` (place items on a 2x2 grid, tap or arrow keys)
and `pin_on_image` (pin on an image, correct area, markers). New picker section "advanced"; strings in
`messages/en/slides-advanced.json` (namespace `slidesAdvanced`, listed in `LiveIntlProvider`). Specs:
`e2e/advanced-slides.spec.ts`; docs in `presentations.md`, `live-surfaces.md`,
`presentation-builder.md`. Merge fixes: the e2e spec opens the lobby explicitly (W1-A2), and the
backend answer test accepts W2-D's richer `AnswerResult`.

**Wave 3 — W3-E imports** (merged; `pkg/w3-e`). `POST /api/imports` (PPTX, PDF, Google Slides link or
Drive file as queued jobs), `GET /api/imports/:id` (job status), `POST /api/imports/questions` (CSV/XLSX
question files, synchronously), `GET /api/imports/templates/questions.:format`.
PPTX: slide order from `sldIdLst`, title → heading, body → bullets/paragraph, picture-dominated → image,
notesSlide → notes, charts/SmartArt/EMF/video → warnings (+ rendered fallback when Gotenberg is set);
PDF pages → image slides with text as notes and alt. Redis list + BLMOVE queue with a reaper
(`workers/import.worker.ts`, in-process unless `IMPORT_WORKER_INPROCESS=0`, then `bun run
worker:import`), migration `150-import-jobs`, SSRF-guarded Google fetch, size/slide caps,
`consumeUsage(ws,'import')` once per job creation. Frontend `features/imports` (Import dialog in the
library, job status, questions preview, "Import questions" in the builder). Wiki
`backend/docs/wiki/modules/imports.md`, `frontend/docs/wiki/features/imports.md`; spec
`e2e/imports.spec.ts` (disabled-mode flows; the e2e backend has no S3). Merge fixes: the jobs starter
keeps the auto-reveal and import workers (the live distribution worker is gone with W2-D), and the
spec uses the shared `host` fixture (which now sets the `auth_session` cookie on the context).

**Wave 2 — W2-B Q&A and reactions** (merged; `pkg/w2-b`). Backend `modules/qna` (questions, upvotes,
moderation, pin, answered, highlight on stage, per-participant rate limits, profanity mask, coalesced
`qna:votes`, migration `050-qna`) and `modules/reactions` (`reaction:send` socket event, coalesced
`reaction:burst`, 300/s cap); the `qna` board slide type; deck settings `qna` / `reactions`. Frontend
`features/qna` and `features/reactions` plug into the live slots and the reducer registry (participant
tab and sync, host moderation drawer, presenter panel, highlight overlay, reactions bar and floating
emoji), the builder gets an Audience tab; strings in `messages/en/qna.json` (listed in
`LiveIntlProvider`). Wiki `modules/qna.md`, `realtime/qna.md`, `features/qna.md`; spec
`e2e/qna-reactions.spec.ts`. Merge fixes after W1-A2: the Q&A reducer ignores the legacy
`lobby:opened` / `quiz:ended` copies (as the core does), the Q&A state tests start from a surface that
follows the session (the reducer drops events of other sessions), W1-A2's slot tests use the one slot
no module registers on (`participantBody`, because importing `features/registrations` in any test
registers Q&A, reactions and sessions process-wide), and the e2e spec opens the lobby explicitly.

**Wave 3 — W3-B1 teams, roles, sharing and audit** (merged; `pkg/w3-b1`). Role action matrix
(`common/tenancy/roles.ts`, `policy.ts`) and `ResourceShare` evaluation (`assertCanWithShares` /
`canWithShares` in `presentations/access.ts`); members API under `/api/workspaces/:workspaceId/members`
(role/status changes with last-owner and primary-owner guards, ownership transfer, leave); invites
(`/api/workspaces/:workspaceId/invites`, hashed tokens, 7-day TTL, rate limits, atomic single-use
`POST /api/invites/:token/accept` with email match; the create response returns `inviteUrl` once and
`emailSent`); `/api/shares`; `GET /api/audit`; migration `100-workspace-invites`; seat limit
`assertLimit(ws,'seats',n)` on invite create/accept and reactivation. Frontend: members page,
`/invites/[token]`, ShareDialog ("Share with team…" in the library card menu), audit page; the login
redirects back to the invite. `tenancy-isolation.test.ts` introspects the route table (every `/api`
route runs a workspace context or is allow-listed with a reason) and attacks one workspace from another
over REST and sockets. Post-merge glue: accepting an invite and reactivating a member call
`syncSeatsAfterMembershipChange` (`billing/seatSync.ts`: background `syncWorkspaceSeats`, no-op without
Stripe), covered by `tests/integration/members.seats.test.ts`; the allow-list got the import routes and
no longer marks mounted routes as planned. Wiki `modules/members-sharing.md`, `platform/tenancy.md`.

**All nine work packages of this session are merged** (W1-A2, W2-B, W2-C, W2-D phase 1, W2-E, W3-B1,
W3-C, W3-E, W3-F); the `pkg/*` branches and `.claude/worktrees/*` are left in place for the owner to
delete (`git worktree remove`, `git branch -d pkg/<id>`; `worktree-agent-a671664cdf32aafd4` is the old
select_answer branch, also merged).

**UI redesign — UI-L landing, sign-in pages and the app-wide design foundation** (merged; `pkg/ui-landing`,
`6328a09`). Foundation in `frontend/app/globals.css`: zinc neutrals, one yellow accent (`#facc15` dark /
`#eab308` light, `accent-ink` `#a16207` for accent text on white), `faint`, `success` / `warning` / `info`,
`chart-1..6`, radii 6/8/12/16, Geist Sans + Mono (Amethysta dropped); a light-mode `text-primary` shim maps
to `accent-ink`. Primitives restyled: Button (new `touch` and `xl` sizes), Input, Textarea, Card, Dialog,
AlertDialog, Popover, DropdownMenu, new Badge, inline-SVG ProductLogo. The landing page is rebuilt with
truthful copy (no fake logos or claims); login, signup, forgot/reset password, verify email, auth-complete
and the invite page share one auth shell (`features/auth/components/AuthShell`). Spec
`e2e/landing-auth.spec.ts` (11 tests); `docs/wiki/ui/design-system.md` rewritten, new
`docs/wiki/features/landing-auth.md`. Integration additions: the Playwright config blanks every optional
integration and the two `NEXT_PUBLIC_*` values a local `backend/.env` / `frontend/.env.local` may set, and
`backend/tests/preload.ts` blanks the same integrations for `bun test` (Bun loads `backend/.env`; without
this a developer's real Resend/LLM/S3 keys would be used by the tests).

**Checks at handoff** (integration head after UI-L, `7dc5c3f` plus this docs commit): backend `bun x tsc --noEmit`
clean; `bun test` 1326 tests (984 run without containers, 342 integration/spike tests skip without
`TEST_MONGO_URI`, 0 fail); integration + spikes with the containers 299 pass, 6 skipped by design, 0 fail;
frontend typecheck clean, lint 0 errors (6 warnings), 635 unit tests, build green, Playwright e2e 46
tests green (the frontend checks ran in a clean worktree of that commit that also had decoy
`backend/.env` and `frontend/.env.local` files, to prove the e2e servers ignore them).

## Left to do (nothing is half-merged)

- **W2-D phase 2** (unblocked, W1-A2 and W2-D phase 1 are merged; plugs into the single `submitAnswer`): frontend offline queue (`submitAnswer`: socket ack → REST →
  IndexedDB, in `live/store` + `live/offline/**`), frontend contract types (`slideTicket`, `AnswerResult`,
  error codes `NOT_ACCEPTING`, `TIME_UP`, `ALREADY_ANSWERED`, `RATE_LIMITED`, `NOT_JOINED`), await the
  `live:join` ack before `answer:submit` after a reconnect, remove the legacy `quiz:event` dual-emit.
- **W2-A** presenter view + remote + timer/kick, **W2-F** audience pace, **W3-D** SAML / per-workspace
  OIDC / SCIM, **W3-B2** folders/templates/duplicate/co-editing. (**W3-A** themes and brand kits are built:
  `backend/docs/wiki/modules/themes.md`.)
  (**W3-G** workspace insights is built: `GET /api/insights` and the `/analytics` overview, see
  `backend/docs/wiki/modules/insights.md`.)
- **Wave 4:** W4-A accessibility, W4-B locales (`es`), W4-D embeds/oEmbed/add-in panes, W4-E custom
  domains/white-label. (**W4-C** GDPR/retention is built: `/api/me` export and deletion, the account
  and retention purge jobs, participant self-removal, `/settings/privacy`, see
  `backend/docs/wiki/modules/privacy.md` and `docs/compliance/`.)
- **Close-out:** refresh `01-competitive-roadmap.md` status tables, README "What's next",
  `backend/docs/wiki/quiz-roadmap.md`; push the branch and open a PR (ask the owner first).

Remaining merge order (from the plan; flexible when a later package is ready early and conflicts are
trivial, note deviations here): W2-D phase 2 → W2-A (adds the NotesTab and the `notes` field of the
frontend `Presentation` type) → W2-F; Wave 3: W3-D and W3-B2 (W3-B1 is merged), W3-A after W2-A, then
Wave 4 A → B → C → D → E; then the close-out.

## Process notes

- Work packages ran as parallel agents, each on its own branch `pkg/<id>` in its own worktree
  (`.claude/worktrees/<id>`), merged into `chore/backlog-and-roadmap` by an integrator in readiness
  order (plan order where conflicts matter). Package specs and rules used by the orchestration live in
  `.claude/orchestration/` (untracked local files: `agent-rules.md`, `integrator-rules.md`,
  `orchestration-state.md`, `packages/<id>.md`); recreate from the plan if they are gone. A later
  session can do the same: one worktree per package, `bun install` in `backend/` and `frontend/`, merge
  `chore/backlog-and-roadmap` into the branch before asking for the merge.
- Each agent has its own test Mongo DB / Redis index / ports (integrator: `openpoll_int` + redis 6390/9,
  `openpoll_e2e` + redis 6390/13, ports backend 5103 / frontend 3103). Heavy frontend commands
  (typecheck, build, e2e, `next dev`) are serialized with
  `flock /tmp/claude-1000/openpoll-heavy.lock <cmd>`; the machine has 15 GB RAM.
- A second test Redis container, `openpoll-test-redis2` on :6391, exists beside `openpoll-test-redis` and
  `openpoll-test-mongo`; remove all three when the roadmap is done.
- **Tenancy allow-list:** every new `/api` route must either run `workspaceContext()` /
  `pathWorkspaceContext()` or be allow-listed with a reason in
  `backend/tests/integration/tenancy-isolation.test.ts` (the route-table test fails otherwise).
- **E2E specs** use the shared `test` / `host` from `e2e/fixtures.ts` (one login per worker; the proxy
  cookie is set on the context) and `openLobby(hostPage, code)` before participants join (opening the host
  page opens nothing since W1-A2).
- `.claude/orchestration/` is excluded locally through `.git/info/exclude`: never commit anything under
  `.claude/`. If `tsc` trips on a corrupt `frontend/.next/dev/types/validator.ts` (a killed `next dev`),
  `rm -rf frontend/.next/dev` (only when no `next dev` is running: the owner's dev servers on 3000/5000 use
  that directory, and a second `next dev` in the same directory is blocked by its lock, so run the e2e
  suite from a clean `git worktree` of the commit under test, with its own `bun install`).
- Local dev files `backend/.env` and `frontend/.env.local` are gitignored and hold the owner's keys: never commit
  them. Tests must not depend on them (see the UI redesign entry); the owner's dev data lives in
  `openpoll_dev` on Mongo :27117 and Redis :6391/0, apart from the integrator's databases.
- Every merge: `git merge --no-ff pkg/<id>`, never hand-merge `bun.lock` (take ours, `bun install`),
  regenerate route snapshots rather than hand-merging them, and re-run all checks listed above.

## Cross-package follow-ups

- **AI deck mappers for W2-E types** (W2-E is merged): add one entry each in
  `backend/src/modules/ai/deck/slideMappers.ts` and `deck/mock.ts` (and for `qna` if wanted).
- **Q&A section in session reports and exports** (W2-B is merged, W2-C reports do not show Q&A yet).
- **Plan gates still to apply** (feature keys exist from W3-C; W2-C gates XLSX/PDF, W3-F consumes
  `ai_deck`, W3-E consumes `import`, W3-B1 enforces `seats` on invites, W3-A `brand_kits`): W3-D `sso` /
  `scim` and seats (`assertSeats` from `workspaces/members.service.ts`, plus
  `syncSeatsAfterMembershipChange` after provisioning a member); W4-E `custom_domains` /
  `white_label`. (W4-C retention is enforced by the `privacy-retention-purge` job.)
- **W3-B2 must delete a folder's `ResourceShare` rows when it deletes a folder** (sharing reads the raw
  `folders` collection).
- **Proxy protected prefixes:** add `/presentations` and `/presentation/create` (signed-out visitors
  currently see a load error instead of a login redirect; check the redirect works).
- **E2E login rate limit** (10 per 5 min per IP): the `host` fixture logs in once per worker (W1-A2). Do not add per-test or per-file logins; billing.spec still logs in once in its own `beforeAll`.

## Known follow-ups

- Cleanup job for presigned uploads that never complete.
- `/presentation/create` is not in the proxy's protected prefixes (see above).
- Backend accepts image/video content slides without a source (draft placeholders) — confirm.
- Owner to confirm defaults: plan limits (`common/plans/plans.ts`), assessment gradeability
  enforced on publish only, anonymous-poll cap 50 votes/IP/poll/day, rate-limit numbers.
- Deployment topology: sockets, timers, scheduler and workers need a long-lived process;
  confirm Vercel container functions or use the compose/Traefik backend.
- **W3-F (merged):** mock decks (no AI key) are not counted against `ai_deck` usage (owner to confirm); a
  reviewed deck (outline step then deck step) uses two `ai` rate-limit hits; the frontend `Presentation`
  type has no `notes` until W2-A's NotesTab lands.
- **W1-A2 (merged):** participants do not resync on seq gaps because the room seq also counts
  host-only events (resync on reconnect, seq reset and tab focus only). `frontend/i18n/LiveIntlProvider.tsx`
  lists its namespaces by hand (`["live","presenter"]`): every package that adds a namespace used on
  live surfaces (W2-E `slides-advanced`, W2-B `qna`) must append to it, keeping all of them.
- **W2-E (merged), cosmetics:** the slide picker is clipped by the rail's overflow-hidden (pre-existing
  rail layout); the inspector badge says "Scored" for ungraded guess/pin slides. AI whole-deck authoring
  does not know the four types yet: add one entry each in `ai/deck/slideMappers.ts` and `deck/mock.ts`.
- **W3-E (merged):** the Google Picker UI is not built (the backend accepts `driveFileId` +
  `driveAccessToken` and works); untested against real PowerPoint files, Gotenberg or Google; the
  import worker runs in-process by default in every environment (set `IMPORT_WORKER_INPROCESS=0` plus a
  worker instance in production); Google export redirects to `*.googleusercontent.com` are allowed.
- **UI redesign leftovers (UI-L):** the dashboard and the builder still hard-code the old sandy colours
  (`rgba(216,173,135,…)`, `#d8ad87`) in the analytics page, `QuestionAnalytics`, `LivePreview`,
  `PollQuestionCard` and `basic-dropdown`; the live screens redesign (`pkg/ui-live`) was still in progress
  when this was written.
- **E2E noise:** a full run logs `Logout failed: AxiosError ... 429` from the browser (an auth route
  rate limit hit by a page whose session refresh failed; the signed-out landing and sign-in specs make it
  frequent); harmless so far, but signed-out pages should not call logout at all: look at it if it ever
  coincides with a failure.
- **W2-B (merged):** the participant Q&A tab shows until the deck is known not to use Q&A (the slot's
  `when` has no store access and runs at render, so an unknown deck counts as available; W1-A2's store
  now makes a proper fix possible); `QnaParticipantSync` bridges participant-addressed events from
  `live:event` and goes away with the legacy `quiz:event` dual-emit (W2-D phase 2); the W2-A audience
  window must forward `reaction:burst`; add a Q&A section to session reports and exports (W2-C).
- **Test registries:** `features/registrations` registers modules process-wide as soon as a unit test
  imports a host/participant surface, so unit tests that count slot entries or compare whole live
  states must use unregistered slots / cope with the extra module slices (`demo` in reducer tests).
- **W2-D phase 1 (merged):** socket.io's polling fallback needs sticky sessions across instances (or a
  websocket-only client), see `docs/deploy/multi-instance.md`; CI load-test thresholds are unverified on
  GitHub runners (tune `STORM_MIN_RPS` / `STORM_MAX_P95_MS`); a crashed instance can lose up to 50 ms of
  queued answer writes.
- **W2-D / e2e (observed once, not reproduced):** one full Playwright run after the W2-C merge printed
  `[Presentation] Answer reconciliation failed: ...` (a non-duplicate-key bulk write error from
  `reconcileAnswers` in `live/snapshot.ts`; the test still passed and two re-runs were clean). If it
  recurs, capture the whole error (`bun run test:e2e` output, unfiltered) before changing anything.
- **W2-C (merged):** public share links show free-text answers (word cloud, open ended) without
  authorship (owner awareness); PDF export uses Helvetica, so emoji/CJK print as `?`; session delete
  uses policy `deck:delete` (owner to confirm). XLSX/PDF export needs a plan that has them
  (`bun scripts/set-plan.ts <workspace|owner-email> pro`).
- **W3-B1 (merged):** there is no `messages/en/workspaces.json` (the members, audit and invite pages
  use plain English like the other settings pages); the Team plan needs more than one seat before a team
  can invite (`bun scripts/set-plan.ts <workspace|owner-email> team`, or a Stripe subscription with
  seats); invites are emailed only when Resend is configured, otherwise the link is returned once in
  the create response (`inviteUrl`, `emailSent:false`) and logged in development.
- **W3-C (merged):** Team seats = purchased capacity (the sync job only raises the quantity); the poll
  response cap reuses the plan `audienceCap`, so existing free polls with over 100 responses stop
  accepting; "Contact sales" uses `NEXT_PUBLIC_SALES_EMAIL` and is disabled while unset.

## Deploy notes

- Containers start with `start:prod` (migrations, then server). Deploy with **no live
  sessions** (migration 030 changes Redis keys).
- Production refuses to boot without `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `JWT_REFRESH_SECRET`,
  `REDIS_URL`, `FRONTEND_URL`; and `OIDC_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` when that provider is
  configured. New optional groups (Stripe, S3, Gotenberg, Drive, domains, metrics,
  `ENCRYPTION_KEY`) are in `backend/.env.example`.
- **AI (W3-F, merged):** set `LLM_BASE_URL` + `LLM_API_KEY`, or `GEMINI_API_KEY`. Without a provider the
  endpoint answers with mock data and labels it as mock.
- **W2-D phase 1 (merged):** `METRICS_TOKEN` (at least 16 characters) enables `/metrics`;
  `SOCKET_REDIS_ADAPTER=on` for more than one backend instance; see `docs/deploy/multi-instance.md`.
- **W3-B1 (merged):** `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (optional for emailed workspace invites,
  required in production anyway), `FRONTEND_URL` (invite links), a plan with more than one seat; migration
  `100-workspace-invites`.
- **W3-E (merged) owner setup:** an S3 bucket (`S3_*`, required for PPTX/PDF imports and stored
  pictures; without it those imports answer with a clear disabled-mode message), optional
  `GOTENBERG_URL` (`gotenberg/gotenberg:8`, high-fidelity PPTX), optional Google Cloud keys
  (`GOOGLE_DRIVE_IMPORT_ENABLED=true`, `GOOGLE_DRIVE_API_KEY`, `GOOGLE_DRIVE_APP_ID`, Google OAuth), a
  worker instance (`bun run worker:import`, same `MONGO_URI`/`REDIS_URL`/`S3_*`/`GOTENBERG_URL`/
  `ENCRYPTION_KEY`) when `IMPORT_WORKER_INPROCESS=0`; migration `150-import-jobs`. Full list in
  `backend/docs/wiki/modules/imports.md`.
- **W3-C (merged; billing is disabled without keys):** two Stripe products (Pro, Team) with monthly and
  yearly recurring prices (Team per seat); env `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_{PRO,TEAM}_{MONTHLY,YEARLY}`; webhook endpoint `/api/billing/webhook` subscribed to
  `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.paid`,
  `invoice.payment_failed`; Customer Portal configuration; optional Stripe Tax +
  `STRIPE_AUTOMATIC_TAX=true`; `FRONTEND_URL`; migration `120-stripe-events`. Full list in
  `backend/docs/wiki/modules/billing.md`.

## Local test services

Dedicated containers (never use the dev ports 27017/6379, which belong to other projects):

```bash
docker start openpoll-test-mongo openpoll-test-redis   # Mongo :27117 (replica set rs0), Redis :6390
cd backend && TEST_MONGO_URI='mongodb://127.0.0.1:27117/openpoll_int?directConnection=true' \
  TEST_REDIS_URL=redis://127.0.0.1:6390/9 bun test integration tests/spikes
cd frontend && E2E_MONGO_URI='mongodb://127.0.0.1:27117/openpoll_e2e?directConnection=true' \
  E2E_REDIS_URL=redis://127.0.0.1:6390/13 bun run test:e2e   # system Chromium at /usr/bin/chromium
```

If the containers are gone: `docker run -d --name openpoll-test-mongo -p 127.0.0.1:27117:27017 mongo:7 --replSet rs0`,
then `docker exec openpoll-test-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'`,
and `docker run -d --name openpoll-test-redis -p 127.0.0.1:6390:6379 redis:7-alpine`.
