---
summary: State of the backlog + roadmap work on branch chore/backlog-and-roadmap, and what is left.
status: active
last_updated: 2026-10-19
---

# Handoff — backlog and roadmap work

All work is on the local branch **`chore/backlog-and-roadmap`** (110+ commits ahead of `main`,
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
before W1-A2 (plan order was A2 → D) because it was ready first and is backend-only; W1-A2 takes it
before it finishes.
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
- Phase 2 (not started): see "Not started".

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

**Checks at handoff** (integration branch after the W3-E merge): backend 1156 tests in `bun test` (900 run without containers, 256 integration/spike tests skip without `TEST_MONGO_URI`), 215 integration/spike tests pass with the containers (6 skipped by design); frontend 553 unit tests; Playwright e2e 32 tests green; backend and frontend typecheck clean, frontend lint 0 errors (7 pre-existing warnings), build green.

## Ready, NOT merged

Nothing is waiting for a merge right now besides what is under "In progress". Merge rule: `git merge --no-ff pkg/<id>` into `chore/backlog-and-roadmap`, then full checks (backend
tsc + unit + integration, frontend typecheck + lint + unit + build + e2e). Expect small conflicts in
append-only files (route snapshot, `i18n/messages.ts`, settings sections, `.env.example`).

## In progress, NOT merged (branches with WIP commits)

Resume each by reviewing the branch against its plan section (`git log --oneline
chore/backlog-and-roadmap..pkg/<id>`, `git diff`), keep what is sound, then finish, merge the
integration branch into it, re-run checks and ask for a merge. Worktrees in
`.claude/worktrees/<id>` (gitignored); heads at wrap-up:

- **W2-B** Q&A + reactions, `pkg/w2-b` @ `bf9f7c3` (11 commits).
- **W3-B1** teams/roles/sharing/audit, `pkg/w3-b1` @ `7e81566` (10 commits).


## Not started

- **W2-D phase 2** (unblocked, W1-A2 is merged; plugs into the single `submitAnswer`): frontend offline queue (`submitAnswer`: socket ack → REST →
  IndexedDB, in `live/store` + `live/offline/**`), frontend contract types (`slideTicket`, `AnswerResult`,
  error codes `NOT_ACCEPTING`, `TIME_UP`, `ALREADY_ANSWERED`, `RATE_LIMITED`, `NOT_JOINED`), await the
  `live:join` ack before `answer:submit` after a reconnect, remove the legacy `quiz:event` dual-emit.
- **W2-A** presenter view + remote + timer/kick, **W2-F** audience pace, **W3-D** SAML / per-workspace
  OIDC / SCIM, **W3-B2** folders/templates/duplicate/co-editing, **W3-A** themes/brand kits,
  **W3-G** workspace insights.
- **Wave 4:** W4-A accessibility, W4-B locales (`es`), W4-C GDPR/retention (enforce `retentionDays`),
  W4-D embeds/oEmbed/add-in panes, W4-E custom domains/white-label.
- **Close-out:** refresh `01-competitive-roadmap.md` status tables, README "What's next",
  `backend/docs/wiki/quiz-roadmap.md`; push the branch and open a PR (ask the owner first).

Remaining merge order (from the plan, flexible when a later package is ready early and conflicts
are trivial; note deviations here): W1-A2 → W2-D → W2-A → W2-B → W2-E → W2-F → W2-C; Wave 3
B1 → B2 → A → C → D → E → F → G; Wave 4 A → B → C → D → E. Already deviating: W3-F merged first;
W2-D (phase 1), W2-C, W3-C are queued ahead of W1-A2 because they are ready.

## Process notes

- Work packages run as parallel agents, each on its own branch `pkg/<id>` in its own worktree
  (`.claude/worktrees/<id>`), merged into `chore/backlog-and-roadmap` by an integrator in readiness
  order (plan order where conflicts matter). Package specs and rules used by the orchestration live in
  `.claude/orchestration/` (untracked local files: `agent-rules.md`, `integrator-rules.md`,
  `orchestration-state.md`, `packages/<id>.md`); recreate from the plan if they are gone.
- Each agent has its own test Mongo DB / Redis index / ports (integrator: `openpoll_int` + redis 6390/9,
  `openpoll_e2e` + redis 6390/13, ports backend 5103 / frontend 3103). Heavy frontend commands
  (typecheck, build, e2e, `next dev`) are serialized with
  `flock /tmp/claude-1000/openpoll-heavy.lock <cmd>`; the machine has 15 GB RAM.
- A second test Redis container, `openpoll-test-redis2` on :6391, exists beside `openpoll-test-redis` and
  `openpoll-test-mongo`; remove all three when the roadmap is done.
- Every merge: `git merge --no-ff pkg/<id>`, never hand-merge `bun.lock` (take ours, `bun install`),
  regenerate route snapshots rather than hand-merging them, and re-run all checks listed above.

## Cross-package follow-ups

- **AI deck mappers for W2-E types** (after W2-E lands): add one entry each in
  `backend/src/modules/ai/deck/slideMappers.ts` and `deck/mock.ts`.
- **Q&A section in session reports and exports** once W2-B merges (W2-C reports).
- **Plan gates still to apply** (feature keys exist from W3-C; W2-C already gates XLSX/PDF, W3-F already
  consumes `ai_deck`): W3-A `brand_kits`; W3-D `sso` / `scim` and `assertLimit(ws,'seats',n)` (+
  `syncWorkspaceSeats`); W3-B1 seats on invites (`assertLimit(ws,'seats',n)`); W4-E
  `custom_domains` / `white_label`; W4-C retention; W3-E `consumeUsage(ws,'import')`.
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
- **E2E noise:** a full run logs `Logout failed: AxiosError ... 429` from the browser (an auth route
  rate limit hit by a signed-in page whose refresh failed); harmless so far, look at it if it ever
  coincides with a failure.
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
