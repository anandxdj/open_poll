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

**Checks at handoff:** backend 625 unit tests, 104 integration/spike tests; frontend 193 unit
tests; Playwright live-flow e2e green; typecheck clean; lint 0 errors.

## In flight — not merged

- Branch **`worktree-agent-a671664cdf32aafd4`** (worktree `.claude/worktrees/agent-a671664cdf32aafd4`),
  commit `abaa8e8`: multi-select + ungraded `select_answer` in builder and live views. Feature
  commit is complete; merging it into `chore/backlog-and-roadmap` conflicts (docs
  `live-surfaces.md`, `e2e.md`, `builder.editor-registry.test.ts`, and the select_answer
  views). Merge, resolve, run checks.
- W1-A2, W2-B, W2-C, W2-E were stopped before writing anything; start them fresh.

## Left to do (order from `04-implementation-plan.md`)

1. **Wave 1 finish:** merge the select_answer branch; **W1-A2** session-aware live UI — switch
   client to `live:join`/`live:event`; host reads `GET /:id/host/state` instead of auto-opening a
   lobby; Start / Present again; `start` for content-only decks; back/forward via `goto`; Close
   voting / Reopen; participant resync via `live-state`; reducer handles `slide:shown` and
   `currentSlide` on late join; per-event server clock offset (countdown bug); new error codes;
   `presenter.json` strings.
2. **Wave 2:** W2-D scale/offline (Lua answer path, redis-adapter, `/metrics`, load test,
   offline queue, remove legacy `quiz:event` dual-emit, fix score double-add race at `end`),
   W2-A presenter view + remote + timer/kick, W2-B Q&A + reactions, W2-E advanced types,
   W2-F audience pace, W2-C session reports/export/share/take-home.
3. **Wave 3:** W3-B1 teams/roles/sharing/audit, W3-B2 folders/templates/duplicate/co-editing,
   W3-A themes/brand kits, W3-C billing (Stripe, disabled without keys), W3-D SAML/per-workspace
   OIDC/SCIM, W3-E import (PPTX/PDF/CSV/XLSX/Google Slides), W3-F AI whole-deck, W3-G insights.
4. **Wave 4:** W4-A accessibility, W4-B locales (`es`), W4-C GDPR/retention (enforce
   `retentionDays`), W4-D embeds/oEmbed/add-in panes, W4-E custom domains/white-label.
5. **Close-out:** refresh `01-competitive-roadmap.md` status tables, README "What's next",
   `backend/docs/wiki/quiz-roadmap.md`; push the branch and open a PR (ask the owner first).

## Known follow-ups

- Cleanup job for presigned uploads that never complete.
- `/presentation/create` is not in the proxy's protected prefixes.
- Backend accepts image/video content slides without a source (draft placeholders) — confirm.
- Owner to confirm defaults: plan limits (`common/plans/plans.ts`), assessment gradeability
  enforced on publish only, anonymous-poll cap 50 votes/IP/poll/day, rate-limit numbers.
- Deployment topology: sockets, timers, scheduler and workers need a long-lived process;
  confirm Vercel container functions or use the compose/Traefik backend.

## Deploy notes

- Containers start with `start:prod` (migrations, then server). Deploy with **no live
  sessions** (migration 030 changes Redis keys).
- Production refuses to boot without `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `JWT_REFRESH_SECRET`,
  `REDIS_URL`, `FRONTEND_URL`; and `OIDC_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` when that provider is
  configured. New optional groups (Stripe, S3, Gotenberg, Drive, domains, metrics,
  `ENCRYPTION_KEY`) are in `backend/.env.example`.

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
