---
summary: Wave-by-wave implementation plan for roadmap Epics 1–11, designed for parallel worktrees with exclusive file ownership.
status: active
last_updated: 2026-10-18
---

# Implementation Plan — Epics 1–11

Read [`01-competitive-roadmap.md`](./01-competitive-roadmap.md) for the *why*. This is the *how*:
the data model, the shared extension points that land first, and the waves of work packages.
Epic 0 (security) is tracked in [`02-security-hardening.md`](./02-security-hardening.md) and
lands before Wave 0.

Paths are relative to the repo root. **Owns** = only that package edits the file during its wave.
**Light** = the package may change only the named hunk.

## Owner decisions taken (defaults; change in `common/plans/plans.ts` / docs)

| Decision | Default chosen |
| --- | --- |
| Plan limits | free: audience cap 100 (matches landing "100 responses"); pro 1,000; team 2,000; enterprise custom. CSV export free; XLSX/PDF export, brand kits, SSO, custom domains, white-label gated. |
| Polls | Stay a compatibility entity. "Convert to presentation" is opt-in and copies questions, not responses. |
| Co-editing | Presence + slide-level operations with revision checks (409 on conflict). No CRDT. |
| Deletion grace | 30 days soft delete, then purge. |
| Locales | `en` + `es` for participant strings. |
| Topology | Sockets, timers, the job scheduler and import workers need a long-lived process. The Traefik/compose backend is the reference deployment; see `docs/deploy/multi-instance.md`. |

## 0. Current-code facts that shape the plan

1. **Two copies of the live UI.** `features/presentations/components/HostView.tsx` wraps
   `features/quizzes/components/HostView.tsx` (~800 lines), which calls `/api/quizzes/*` (aliased to
   `presentationsRouter`). Dashboard, `/quiz/*` routes and `GlobalClientLayout` import
   `features/quizzes`. `features/presentations/components/slides/host/*` is dead. Consolidated in W0-C.
2. **Prev button broken.** HostView "Prev Slide"/ArrowLeft call `advance(i-1)`; `advanceSlide`
   rejects backwards moves while `active`.
3. **Reopening the host page wipes the last run.** HostView calls `openLobby` on mount when status is
   `draft`/`ended` or `?reset=true`; `openLobby` deletes participants, answers and Redis keys.
4. **Live updates sent twice.** Every answer publishes `answer:received` and
   `liveDistribution.worker.ts` re-publishes every 2s; its `sMembers`+`del` races across instances.
5. **Redis adapter would duplicate events.** The socket subscriber uses `io.to(room).emit`; with
   `@socket.io/redis-adapter` every instance would re-broadcast cluster-wide. Use `io.local.to(room)`.
6. **Global middleware traps.** `mongoSanitize` strips body keys containing `.` (breaks SCIM
   `urn:…:2.0:User`). Global `express.json({limit:'100kb'})` breaks Stripe raw-body signatures, SAML
   ACS (urlencoded) and large decks. API sends `CORP: same-site`, so media must come from storage/CDN.
7. `/api/ai/generate-quiz` has no `authenticate()` and no rate limit (Epic 0 follow-up).
8. Dashboard `LIVE_STATUSES` uses old status names, so the live count is always 0.
9. `frontend/middleware.ts` is deprecated in Next 16 → `proxy.ts`
   (`frontend/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
10. Backend deploys both as a Vercel container and behind Traefik; long-lived assumptions everywhere.
11. Backend tests are `bun:test` with monkeypatched models; frontend has no tests.
12. Countdown offset bug: `info.serverNow` is captured once at page load but the clock offset is
    recomputed from it at each question, so a participant who waited in the lobby sees a countdown
    that is too long. Fix in W1-A2.

## 1. Data model

**Conventions:** production `autoIndex: false`, indexes created in migrations. Unique indexes on
backfilled fields use `partialFilterExpression: {f: {$exists: true}}`. Every new collection has
`workspaceId` and timestamps. Migrations live in `backend/src/migrations/NNN-*.ts`, run with
`bun run migrate`, idempotent via a `migrations` collection. Number ranges: W0-D 001–009,
W1-C 010–019, W1-B 020–029, W1-A1 030–039, Wave 3 100–199 (10 per package), Wave 4 200+.

### Presentation (`presentations`, extended in place; W1-A1 lands all deck-level fields)

| Field | Type / default | Notes |
| --- | --- | --- |
| `workspaceId` | ObjectId; index `{workspaceId:1, updatedAt:-1}` | Backfilled by migration 020; policy falls back to `creatorId` while missing |
| `folderId` | ObjectId\|null; index `{workspaceId, folderId, updatedAt:-1}` | Epic 9 |
| `pace` | `'presenter'\|'audience'` = `presenter` | Epic 1 |
| `settings` | `{audienceLocale:'en', nickname:'required'\|'optional'\|'off', showResultsOnDevices, qna:{enabled, moderation, anonymousAllowed, upvotes}, reactions:{enabled, emojis[≤6]}, quiz:{leaderboard, showCorrectOnDevices}, audiencePaced:{resultsVisibility:'never'\|'after_submit'\|'after_close', assessment:{enabled, passingScorePercentage, maxAttempts}}, embed:{allowed}}` | All defaulted |
| `theme` | `{presetId:'amber', brandKitId:null, overrides:null}` | Epic 6 |
| `activeSessionId`, `lastSessionAt`, `sessionCount` | | Epic 5 |
| `isTemplate`, `templateSourceId` | | Epic 9 |
| `legacy` | `{source:'poll'\|'quiz', sourceId}\|null`; sparse index | Compatibility |
| `deletedAt` | Date\|null | Trash, GDPR |
| `status`, `currentSlideIndex`, `questionStartedAt`, `questionEndsAt` | unchanged | Mirror of the active session; only `live/session.service.ts` writes them |

**Slide subdocument** (W0-A, additive): `kind:'content'|'interactive'|'system'` (from the registry),
`content: Mixed`, `config: Mixed`, `notes` (≤5000 chars, never sent to participants),
`media:{key,url,alt,layout}|null`, `layout`. `timeLimit` min 0 = untimed (registry enforces ≥5 for
scored types). `question` defaults `''`, validated per type. Legacy flat fields (`options`,
`acceptedAnswers`, …) stay, so the 7 existing types need no migration. New types validate
`content`/`config` with the registry's Zod schema (`markModified` on change).

### PresentationSession (new, `presentationsessions`; W1-A1)

- `presentationId, workspaceId, hostUserId, runNumber, pace, status:'lobby'|'active'|'ended', isLive,
  joinCode, startedAt, endedAt, currentSlideId, currentSlideIndex`.
- `slideStates: Map<slideId,{openedAt, endsAt, pausedRemainingMs, closedAt, revealedAt}>`.
- `deckSnapshot: Slide[]` (frozen at open), `themeSnapshot`, `settingsSnapshot`,
  `entitlementsSnapshot:{audienceCap,…}`.
- Aggregates: `participantCount, answerCount, finalLeaderboard[≤100], slideStats[{slideId, slideIndex,
  type, answeredCount, distribution}]`.
- `share:{token, enabled, includeNames, createdAt, expiresAt}`, `retainUntil`.
- Indexes: `{presentationId:1, startedAt:-1}`, `{workspaceId:1, startedAt:-1}`, `{presentationId:1}`
  unique partial `{isLive:true}` (one live session per deck), `{'share.token':1}` unique sparse,
  `{retainUntil:1}`.

### PresentationParticipant / PresentationAnswer (W1-A1)

- Participant: `sessionId, kickedAt, locale`; unique `{sessionId, deviceId}` (partial); drop old unique
  `{presentationId, deviceId}` after backfill.
- Answer: `sessionId, slideId, clientAnswerId` (idempotency), `via:'rest'|'socket'|'offline'`; unique
  `{sessionId, slideId, participantId}` (partial) + index `{sessionId, slideId}`; drop old unique
  `{presentationId, slideIndex, participantId}` after backfill. `slideIndex` kept for exports.

### New collections

| Collection | Key fields / indexes | Package |
| --- | --- | --- |
| Workspace | `name, slug(unique), type:'personal'\|'team', ownerId, plan:'free'\|'pro'\|'team'\|'enterprise'='free', planSource:'default'\|'stripe'\|'manual', planOverrides, billing:{stripeCustomerId(sparse unique), stripeSubscriptionId, status, priceId, seats, currentPeriodEnd, cancelAtPeriodEnd}, settings:{retentionDays, requireSso, allowedEmailDomains[], embedAllowedOrigins[], defaultTheme}, deletedAt`; partial unique `{ownerId, type:'personal'}` | W0-D |
| WorkspaceMember | `workspaceId, userId, role:'owner'\|'admin'\|'editor'\|'presenter'\|'viewer', status:'active'\|'invited'\|'suspended', source:'manual'\|'scim'\|'sso_jit'`; unique `{workspaceId, userId}`; `{userId}` | W0-D |
| WorkspaceInvite | `workspaceId, email, role, tokenHash, expiresAt` (TTL) | W0-D model, W3-B1 logic |
| WorkspaceGroup | `workspaceId, displayName, externalId, memberIds[]` | W0-D, W3-D |
| ResourceShare | `workspaceId, resourceType:'presentation'\|'folder', resourceId, principalType:'user'\|'group', principalId, role`; unique compound | W0-D, W3-B1 |
| Folder | `workspaceId, parentId, name`; `{workspaceId, parentId}` | W3-B2 |
| QnaQuestion / QnaUpvote | `presentationId, sessionId, slideId\|null, participantId, authorName\|null, text≤280, status:'pending'\|'visible'\|'answered'\|'archived'\|'rejected', pinned, upvoteCount`; `{sessionId, status, upvoteCount:-1}`; upvote unique `{questionId, participantId}` | W2-B |
| BrandKit | `workspaceId, name, colors{background,surface,text,accent,accentText,correct,incorrect,chart[]}, fonts{heading,body:{family,source,url}}, logo, background` | W3-A |
| MediaAsset | `workspaceId, uploaderId, key, url, mime, bytes, source:'upload'\|'import'\|'ai'` | W0-D |
| ImportJob | `workspaceId, userId, kind:'pptx'\|'pdf'\|'csv'\|'xlsx'\|'gslides', status, sourceKey, resultPresentationId, warnings[], error` | W3-E |
| AuditEvent | `workspaceId, actorId, actorType:'user'\|'scim'\|'system'\|'api', action, targetType, targetId, ip, ua, meta, expiresAt` (TTL); `{workspaceId, createdAt:-1}` | W0-D model, W3-B1 UI |
| SsoConnection | `workspaceId, type:'saml'\|'oidc', enabled, domains[{domain, verifiedAt, token}], saml{idpEntityId, idpSsoUrl, idpCerts[], wantAssertionsSigned, attributeMapping}, oidc{issuer, clientId, clientSecretEnc}, jit, defaultRole` | W3-D |
| ScimToken | like `McpToken`: `tokenHash` unique, `prefix`, `last4`, `workspaceId`, `revokedAt` | W3-D |
| StripeEvent | `_id = event id` (idempotency) | W3-C |
| UsageCounter | `workspaceId, period(yyyymm), counter, value` (Mongo mirror of Redis counters) | W0-D |
| CustomDomain | `workspaceId, hostname` (unique, lowercased), `status:'pending'\|'verified'\|'active'\|'failed', verificationToken, provisioner` | W4-E |
| DataExportJob | `userId, status, objectKey, expiresAt` | W4-C |

### Existing collections

- **User** (W0-D lands all fields): `defaultWorkspaceId, locale, active` (SCIM),
  `identities[{provider:'google'|'oidc'|'saml'|'oidc_ws', connectionId, subject}]` with index
  `{'identities.provider':1,'identities.subject':1}`, `scim:{externalId, workspaceId}`,
  `deletionRequestedAt, deletedAt`. `sub` kept.
- **Poll**: `workspaceId` + `{workspaceId, createdAt:-1}` (W1-B); `convertedPresentationId` (W1-C).

### Redis key map (W1-A1)

Session-scoped, hash-tagged (Lua/Cluster-safe):
`psess:{<sid>}:meta` (pace, status, cap), `psess:{<sid>}:slides` (slideId → accept config
`{open, endsAtMs, pausedRemainingMs, cfg}`; presenter pace opens one slide at a time, audience pace
opens all), `:current`, `:scores`, `:correct`, `:names`, `:tokens`, `:kicked`, per slide
`:answered:{slideId}`, `:dist:{slideId}`, `:disp:{slideId}`, `:pts:{slideId}`, `:results:{slideId}`
(full answer JSON, used for reconciliation), `:dirty` (coalescer). Outside the prefix:
`live:{pid}:seq`, `presentation:{pid}:active` → sid, `qna:{<sid>}:*`.

### Migrations / backfill

- **010** legacy quizzes: copy `quizzes`, `quizparticipants`, `quizanswers` into the presentation
  collections (models identical apart from names); regenerate colliding join codes; no-op if empty.
- **020** workspaces: personal workspace per user; `workspaceId` on presentations and polls by
  `creatorId`; `user.defaultWorkspaceId`. Raw collection ops (no schema dependency).
- **030** sessions: legacy session #1 per deck with participants (`deckSnapshot` = current slides);
  set `sessionId`/`slideId` on participants and answers (`slideId = slides[slideIndex]._id`); create
  new partial indexes, drop old ones; end any deck in `lobby`/`active`. Runbook: deploy with no live
  sessions (Redis key format changes).
- **Polls are not migrated** (compat read). Convert-to-presentation (W1-C) copies questions only.

## 2. Waves

### Merge rules

- Owned files are exclusive within a wave; light touches limited to the named hunk.
- Append-only registries (backend `http/routes.ts`, `slides/index.ts`, `realtime/modules.ts`,
  `realtime/events/index.ts`; frontend `slides/runtime.ts`, `slides/editor.ts`,
  `features/registrations.ts`, `lib/proxy/index.ts`): one line per entry, alphabetical.
- Never hand-merge `bun.lock`: take the base copy and re-run `bun install`.
- Each package writes its own wiki page (`backend/docs/wiki/modules/<m>.md`); only the integrator
  edits roadmap docs.
- Paired packages (A1/A2) land a contract doc + TypeScript types first.
- The integrator merges in the stated order and runs full CI after each wave.

### Epic → package map

| Epic | Packages |
| --- | --- |
| 1 Unification | W1-A1, W1-A2, W1-C, W1-D, W2-F |
| 2 Content slides | W1-D |
| 3 Presenter | W2-A |
| 4 Q&A + reactions | W2-B |
| 5 Sessions/export | W1-A1, W2-C |
| 6 Themes | W3-A |
| 7 Import + AI deck | W3-E, W3-F |
| 8 Scale | W2-D |
| 9 SaaS | W0-D, W1-B, W3-B1, W3-B2, W3-C, W3-D |
| 10 a11y/i18n/GDPR | W4-A, W4-B, W4-C |
| 11 Integrations | W4-D, W4-E |

### Wave 0 — extension points, no behavior change (order: T → B → D → A → C1 → C2)

**W0-T App factory, mount table, test harness, dependency spike.**
Owns `backend/src/app.ts` (boot only: connect, `createApp()`, realtime, `startJobs()`, listen),
`backend/src/http/createApp.ts`, `backend/src/http/routes.ts` (mount table for every current and
future module; stub `Router()` files for workspaces, library, sessions, qna, remote, uploads,
imports, themes, templates, folders, billing, sso, scim, privacy, embeds, domains, audit, insights,
capabilities, metrics). Pre-wired special mounts: `/api/billing/webhook` with `express.raw` before
`express.json`; SSO ACS with `express.urlencoded`; `/scim/v2` before `mongoSanitize` with
`express.json({type:['application/json','application/scim+json']})`; `/metrics`; 1mb JSON limit for
`/api/presentations`. `backend/tests/integration/{harness.ts, fixtures.ts}` boots `createApp()` on
port 0 against `TEST_MONGO_URI`/`TEST_REDIS_URL` (skips when unset). CI `integration` job with mongo:7
and redis:7 services. Installs all backend deps up front: `@socket.io/redis-adapter`, `prom-client`,
`stripe`, `@node-saml/node-saml`, `fflate`, `fast-xml-parser`, `unpdf`, `@napi-rs/canvas`,
`papaparse`, `exceljs`, `pdfkit`. Spike tests under Bun (swap the library if any fails): node-saml
signed fixture, redis-adapter + node-redis v5 across two servers, unpdf→PNG via @napi-rs/canvas,
exceljs round trip, pdfkit, stripe `constructEventAsync`, prom-client, fflate + fast-xml-parser on a
fixture pptx. Done when a route snapshot test shows identical routes and CI is green.

**W0-B Realtime core.** Owns `backend/src/common/realtime/**` (`socket.ts` bootstrap,
`registry.ts`, `auth.ts` optional-JWT handshake into `socket.data.user`, `rooms.ts`, `publish.ts`,
`events/index.ts` + `events/presentation.ts`, `modules.ts`, `polls.socket.ts`) and
`backend/src/modules/presentations/presentations.socket.ts` (join handler, still calling
`isOwner`/`isAuthorizedParticipant`). Envelope `{v:1, presentationId, sessionId, seq, type, payload,
audience:'all'|'host'|'participant:<id>', emittedAt, quizId}`; subscriber emits via `io.local.to` to
`live:{pid}`, `live:{pid}:host`, `live:{pid}:p:{participantId}` and dual-emits legacy `quiz:event`
(removed in W2-D); `seq = INCR live:{pid}:seq`. Tests: exactly-once delivery, `answer:received` never
reaches participants, monotonic seq.

**W0-D Platform primitives (all new files).** `common/config/env.ts` gains a `capabilities` object;
`common/tenancy/{roles,policy,workspaceContext.middleware}.ts`;
`common/plans/{plans,entitlements,usage,requireFeature}.ts`; `common/audit/audit.ts`;
`common/jobs/scheduler.ts`; `common/storage/{storage,s3.storage}.ts` (`Bun.S3Client`);
`common/utils/crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY`); `modules/workspaces/*.model.ts` (all models
above) + `provisioning.ts`; `modules/audit/audit.model.ts`;
`modules/uploads/{media.model,uploads.route,uploads.service}.ts`;
`modules/capabilities/capabilities.route.ts`; `src/migrations/{runner,001-bootstrap}.ts`;
`backend/scripts/{migrate,set-plan}.ts`; `.env.example`. Light: `auth.model.ts` (all new User
fields), `package.json` (`migrate`). Workspace context provisions the personal workspace lazily;
policy falls back to `creatorId` until migration 020; `storage.enabled === false` → 503
`STORAGE_DISABLED`. API: `POST /api/uploads/presign`, `POST /api/uploads/complete`,
`GET /api/capabilities` → `{billing, storage, samlSso, scim, pptxHighFidelity, googleDriveImport,
customDomains, metrics, ai}`.

**W0-A Backend slide registry + presentations split (characterization first).** Owns
`backend/src/modules/presentations/**` except `presentations.socket.ts`: `slides/{registry,types,ops,
index}.ts`, `slides/types/<7 existing>.ts`; service split into `live/{keys,session.service,
answer.service,participant.service,distribution,events}.ts`; `routes/{crud,host,participant}.route.ts`
composed by `presentations.route.ts`; `controllers/*`; `models/{presentation,participant,answer}
.model.ts` with `presentations.model.ts` as barrel; `presentations.service.ts` facade keeps signatures;
schema built from the registry, answer schema gains generic `payload`. Adds the slide fields above and
the `content` lifecycle (advancing to a content slide publishes `slide:shown`, no answer window).
Golden tests for sanitize/accept/distribution/score on all 7 types are written **before** the
refactor. Done when no API response differs except new defaulted fields.

**W0-C1 Frontend live surfaces.** Owns `features/presentations/live/{store,reducer,useLiveSocket,
slots}.ts` (zustand store, pure reducer with module sub-reducers; replaces
`hooks/usePresentationSocket.ts`), `features/registrations.ts`, `slides/runtime.ts`,
`slides/types/<7>/{participant,stage}.tsx` (absorbing `components/slides/participant/*`, quizzes
`CardFillRevealChart`/`WordCloud`, dead `slides/host/*`), `components/{stage,participant,host}/**`
(HostConsole = Stage + HostControls), `theme/{tokens.css, DeckThemeProvider.tsx}` (all stage and
participant UI reads `--deck-*` variables; defaults reproduce the current look),
`types/{live,realtime}.ts`, `api/{host,participant}.ts`, `frontend/lib/socket.ts`, `frontend/i18n/*`
(next-intl provider for live routes), `frontend/messages/en/live.json`, `frontend/playwright.config.ts`,
`frontend/e2e/**`, `frontend/tests/unit/**`, pages `app/live/**`, `app/presentation/host/**`;
`app/quiz/{play,host}` → redirects. A Playwright characterization test of the current flow (lobby, 2
participants, select_answer, wordcloud, scales, reveal, leaderboard, end) lands **before** the refactor
and passes after; live routes stop importing `features/quizzes`.

**W0-C2 Builder, dashboard consolidation, editor registry, proxy, headers.** Owns
`slides/{editor,meta}.ts`, `slides/types/<7>/{meta.ts, editor.tsx}`, `components/builder/**`
(BuilderShell; SlideRail with reorder via buttons and keyboard, duplicate, delete, thumbnails via
StageView `mode="thumbnail"`; Inspector with an `inspectorTabs` registry), `PresentationBuilder.tsx`
(shell), `AiPresentationModal.tsx`, `CreatePresentationModal*.tsx`, `types/deck.ts`,
`api/{crud,ai}.ts`; deletes `frontend/features/quizzes/**` (after C1); `app/quiz/{create,join}` →
redirects; `frontend/proxy.ts` (codemod from `middleware.ts`) + `frontend/lib/proxy/{index,auth}.ts`;
`next.config.ts` (next-intl plugin); `frontend/lib/security/headers.ts` (`frame-ancestors 'self'`,
`nosniff`); `GlobalClientLayout.tsx` loses the pathname exclusion list — sidebar moves into
`app/(dashboard)/layout.tsx`, `app/create` and `app/presentation/create` move into `(dashboard)` with
unchanged URLs.

### Wave 1 — Unification spine (order: A1 → B → C → D → A2)

**W1-A1 Session engine (backend).** Owns `backend/src/modules/presentations/**` (except
`slides/types/content/**` and the import lines in `slides/index.ts`), `src/migrations/03x`,
`backend/src/modules/themes/resolve.ts` (stub returning preset tokens). All deck-level fields,
PresentationSession, participant/answer fields. Engine: `start` (session + slide 0, no lobby, for
content-only decks); `open-lobby` creates a new session, ends any previous live one with a snapshot,
never deletes data; `goto` both directions (revisits show stored results); `close`; `reopen`;
`reveal`; `end` writes the snapshot and reconciles Mongo answers missing from the Redis results hash,
sets `retainUntil`; untimed slides; join checks `entitlements.audienceCap` → 403 `SESSION_FULL`.
`assertOwnership` → `assertCan(ctx, 'deck:host'|'deck:edit', deck)`; lists scoped to `req.workspace`.
API: `POST /:id/host/{start,goto,close,reopen}` (`advance` = goto+1 alias), `GET /:id/host/state` adds
`session`, `slideStates`, distributions for visited slides; `GET /:id/live-state?participantId&token`;
`GET /:id/sessions`. Events: `session:lobby` (+ legacy `lobby:opened`), `slide:shown`,
`question:started`, `slide:closed`, `question:revealed`, `leaderboard:shown`, `session:ended`
(+ legacy `quiz:ended`), all with `sessionId`. First commit: contract in
`backend/docs/wiki/modules/presentations-live.md` + TS types. Acceptance: presenting a deck twice
preserves both sessions.

**W1-A2 Session-aware live UI.** Owns `features/presentations/{live, components/stage,
components/host, components/participant, api/host.ts, api/participant.ts, types/live.ts,
types/realtime.ts}/**`, `app/live/**`, `app/presentation/host/**`; deletes legacy barrels. No
auto-open on mount ("Start presenting", "Present again"); back/forward; "Close voting" for untimed
slides; localStorage `openpoll_participant_{code}_{sessionId}`; resync on reconnect via `live-state`;
`slide:shown` shows "Look at the screen"; listens only to `live:event`; fixes the countdown offset bug.

**W1-B Workspaces exposure + polls tenancy.** Owns `backend/src/modules/workspaces/{route,controller,
service}.ts`, `src/migrations/02x`, `frontend/features/workspaces/**`,
`app/(dashboard)/settings/layout.tsx` (nav listing every future section, gated by capabilities and
entitlements; existing content → `settings/profile` and `settings/mcp`; `settings/page.tsx`
redirects), `settings/workspace/page.tsx`. Light: `polls.model.ts` (`workspaceId`), `polls.service.ts`
(scoped create/list), `polls.controller.ts` (`assertCan`), `mcp/mcp.tools.ts` (default workspace),
`frontend/lib/api-client.ts` (`X-Workspace-Id`), `Sidebar.tsx` header block (`<WorkspaceSwitcher/>`).
API: `GET/POST /api/workspaces`, `GET/PATCH /api/workspaces/:id`, `POST /api/workspaces/:id/switch`.

**W1-C Unified library + compatibility.** Owns `backend/src/modules/library/**`
(`GET /api/library?type&folderId&q&cursor` union cards; `POST /api/library/convert/poll/:pollId` →
`pace:'audience'` deck of select_answer slides with `allowMultiple`; TRIAL → assessment settings),
`src/migrations/010-legacy-quizzes.ts`, `frontend/features/library/**`,
`app/(dashboard)/polls/page.tsx` (unified library; fixes `LIVE_STATUSES`), presentations/quizzes
dashboard pages → redirects, `Sidebar.tsx` `navItems` hunk. Acceptance: polls still work via `/p/[id]`,
analytics and MCP; old `/quiz/*` links redirect and play.

**W1-D Content slide types (Epic 2).** Owns backend
`slides/types/content/{heading,paragraph,bullets,image,big_number,quote,video,instructions}.ts`,
frontend `slides/types/<8>/{meta,participant,stage,editor}`, `frontend/features/media/{ImagePicker,
useUpload,VideoEmbed}` (presign upload, or pasted https URL when storage is off). Light:
`lib/security/headers.ts` (`frame-src` youtube-nocookie + player.vimeo; `img-src` https + storage).
Payloads: heading `{title, subtitle}`; paragraph `{title?, body≤2000}`; bullets `{title?, items≤10}`;
image `{key|url, alt (required), fit, caption}`; big_number `{value, label, prefix, suffix}`; quote
`{text, attribution}`; video `{provider:'youtube'|'vimeo'|'file', id|key, start}`; instructions
`{showQr, showCode, text}`. Acceptance: content-only deck presented fullscreen; mixed deck clicked
through live.

### Wave 2 — Epics 3, 4, 5, 8 + audience pace (order: D → A → B → E → F → C)

**W2-A Presenter experience (Epic 3).** Owns backend `presentations/live/{timing.service,
moderation.service}.ts`, `routes/host.route.ts`, `backend/src/modules/remote/**`,
`common/utils/profanity.ts`; frontend `features/presenter/**` (PresenterConsole, NotesPanel,
NextSlidePreview, SessionClock, ResponseCounter, ParticipantList with kick, Controls, AudienceWindow
via `window.open` + BroadcastChannel, RemotePairing QR, `useFullscreen`, mutable sound cues, start
countdown, `builder/NotesTab.tsx`), `features/remote/**`, pages
`app/presentation/[id]/presenter`, `app/presentation/[id]/present`, `app/remote/[token]`. API:
`POST /:id/host/timer {pause|resume|extend, seconds}`, `POST /:id/host/skip`,
`POST /:id/host/participants/:pid/kick`, `POST|DELETE /:id/host/remote-token` (first device to redeem
binds), `GET /api/remote/:token/state`. Socket: `slide:timing`, `participant:kicked`,
`remote:connected|disconnected`; client `remote:join {token}` and `remote:command
{next|prev|reveal|close|extend30|pause|resume}` with acks. Notes never reach participants.

**W2-B Q&A + reactions (Epic 4).** Owns `backend/src/modules/{qna,reactions}/**`,
`slides/types/qna.ts` (`board` lifecycle), `frontend/features/{qna,reactions}/**`,
`slides/types/qna/*`. Participant API (token required, rate-limited per participant, not per IP):
`POST /api/presentations/:id/qna`, `POST|DELETE …/qna/:qid/upvote`, `GET …/qna`. Host:
`GET /:id/host/qna?status`, `PATCH /:id/host/qna/:qid {status, pinned}`,
`POST /:id/host/qna/:qid/highlight`. Socket: `qna:question` (host-only while pending), `qna:updated`,
`qna:votes` (coalesced 500ms), `qna:highlight`; `reaction:send {emoji}` (5/s per socket, 300/s per
session, deck allow-list) → `reaction:burst {counts}` to host + screen. UI via slots.

**W2-C Session history, reports, export, share, take-home (Epic 5).** Owns
`backend/src/modules/sessions/**` (`GET /api/sessions?presentationId`, `GET /api/sessions/:sid`
report, `GET /api/sessions/:sid/export.{csv|xlsx|pdf}` streamed — CSV free, XLSX/PDF behind
`requireFeature`, `POST|DELETE /api/sessions/:sid/share`, `DELETE /api/sessions/:sid`,
`GET /api/sessions/:sid/me?participantId&token`, `GET /api/public/results/:token` rate-limited,
names only if `includeNames`), `frontend/features/sessions/**`, pages
`app/(dashboard)/presentations/[id]/sessions/{page, [sessionId]/page}`, `app/r/[token]` (noindex),
`app/live/[code]/summary`. Reconciliation test: 200 scripted participants; `slideStats`, Mongo
aggregate, CSV and XLSX totals all match.

**W2-D Scale, reliability, offline (Epic 8).** Owns backend `presentations/live/{answer.service,
keys, lua/answer.lua, coalescer}.ts`, `presentations.socket.ts` (`answer:submit` with ack,
`live:resync`), deletes `liveDistribution.worker.ts`, `common/realtime/adapter.ts`
(`SOCKET_REDIS_ADAPTER=on`), `common/observability/{metrics, httpMetrics.middleware, redisTiming}.ts`,
`modules/metrics/metrics.route.ts` (bearer `METRICS_TOKEN`), `backend/loadtest/{answer-storm.ts,
answer-rest.k6.js}`, `docs/deploy/multi-instance.md`, CI `loadtest-smoke`; frontend
`features/presentations/live/offline/**` (IndexedDB queue, `clientAnswerId`, backoff, "Saved — will
sync"), `submitAnswer` in `live/store.ts` (socket ack 3s → REST → offline queue). One Lua call per
answer; idempotent replays; HMAC `slideTicket` grace (unscored: `endsAt + 15s`; scored: until reveal;
auto-reveal 1.5s after timer); coalescer `SET psess:{sid}:dirty NX PX 250`. Light: one adapter line
in `socket.ts`, remove legacy dual-emit; `responses/analytics.worker.ts` replaces `KEYS` with a
per-poll SET. Targets: 2 instances exactly-once; CI smoke ≥500 answers/s p95 < 150ms; 2k/s nightly;
10s offline survives.

**W2-E Advanced interactive types.** `guess_number`, `hundred_points`, `grid_2x2`, `pin_on_image`
(backend `slides/types/advanced/*`, frontend type folders). Reject malformed payloads (sum ≠ 100,
coordinates outside [0,1]).

**W2-F Audience-paced mode (Epic 1, second half).** Owns `presentations/live/audience.service.ts`,
`routes/audience.route.ts` (`POST /:id/host/open-audience {closesAt}`, `POST /:id/host/close-audience`),
`audience-autoclose` job, `components/participant/audience/**`, `components/host/AudienceDashboard.tsx`,
`builder/tabs/PaceSettings.tsx`. Light: one branch in `live/session.service.ts`. All response slides
open at once, no timer or speed scoring; `resultsVisibility` and `assessment` apply; optional
nicknames ("Guest NNNN"). Acceptance: converted poll and converted TRIAL run end to end incl. pass/fail.

### Wave 3 — Epics 6, 7, 9 (order: B1 → B2 → A → C → D → E → F → G)

**W3-A Themes & branding.** `backend/src/modules/themes/**` (presets, BrandKit model,
`GET /api/themes/presets`, `/api/brand-kits` CRUD behind `requireFeature('brand_kits')`, real
`resolve.ts` = preset ⊕ brand kit ⊕ deck overrides, WCAG AA contrast check on save);
`frontend/features/themes/**` (ThemePicker tab, BrandKitEditor, font loader, logo, background);
real `DeckThemeProvider.tsx`; `settings/brand`. Acceptance: non-default theme on presenter, present,
participant, reveal; low-contrast palette rejected.

**W3-B1 Teams, roles, sharing, audit.** `workspaces/{members.route, invites.service,
sharing.service}.ts`, full `common/tenancy/policy.ts`, `modules/audit/{route,service}.ts`,
`backend/tests/integration/tenancy-isolation.test.ts` (introspects the route table: every `/api`
route outside an allow-list runs workspace context + policy; cross-workspace matrix over REST and
socket host-join); frontend members, invites, ShareDialog, `settings/{members,audit}`. API:
`/api/workspaces/:id/members`, `POST /api/workspaces/:id/invites`, `POST /api/invites/:token/accept`,
`GET|PUT /api/shares`, `GET /api/audit`. Acceptance: two workspaces fully isolated.

**W3-B2 Folders, templates, duplicate, co-editing.** `modules/{folders,templates}/**` (seed decks),
`presentations/routes/crud.route.ts` + `controllers/crud.controller.ts` (folder filter,
`POST /:id/duplicate`, slide-level `PATCH|POST|DELETE /:id/slides[/:slideId]`,
`POST /:id/slides/reorder`, `If-Match: <revision>` → 409), `presentations/editor.socket.ts`
(`deck:join`, `presence:update`); frontend folders, templates page, builder presence/conflict UI.

**W3-C Billing & plan gates.** `backend/src/modules/billing/**` (`GET /api/billing`,
`POST /api/billing/{checkout,portal}` → 503 `BILLING_DISABLED` without `STRIPE_SECRET_KEY`; webhook
with raw body + `constructEventAsync`, idempotent via StripeEvent; `checkout.session.completed`,
`customer.subscription.*`, `invoice.payment_failed`; price → plan via
`STRIPE_PRICE_{PRO,TEAM}_{MONTHLY,YEARLY}`; seat sync job; public `GET /api/plans`);
`frontend/features/billing/**`, `settings/billing`. Light: `plans.ts` numbers, landing `Pricing.tsx`
from `/api/plans`, poll response cap via `assertLimit` in `responses.service.ts`. No fake success.

**W3-D SSO (SAML + per-workspace OIDC) & SCIM.** `backend/src/modules/sso/**`
(`GET /api/sso/discover?email`, `GET /api/sso/:connectionId/login`,
`POST /api/sso/saml/:connectionId/acs`, `GET /api/sso/saml/:connectionId/metadata`,
`GET /api/sso/oidc/:connectionId/callback`; node-saml with a Redis `cacheProvider` for InResponseTo
replay protection; JIT provisioning; attribute/group mapping; `requireSso`;
`common/utils/dnsVerify.ts` TXT `_openpoll.{domain}`), `backend/src/modules/scim/**`
(`/scim/v2/{ServiceProviderConfig,ResourceTypes,Schemas,Users,Groups}`, CRUD + PATCH, `eq`/`and`
filters parsed into whitelisted queries, pagination; deactivation suspends membership and revokes
refresh tokens); frontend `settings/{sso,scim}`, `SsoDiscovery.tsx`. Light: `assertSsoNotRequired`
in auth login/register/Google, shared exchange-code helper, `getConfiguration(connection?)`,
one `LoginForm.tsx` hunk. Tests: signed SAML fixtures (valid, wrong audience, expired, replayed,
unsigned), SCIM RFC 7644 examples, Keycloak recipe in `testing/sso/`.

**W3-E Import.** `backend/src/modules/imports/**` (`POST /api/imports {kind, key|url}`,
`POST /api/imports/questions` CSV/XLSX ≤2MB synchronous, `GET /api/imports/:id`, template downloads;
parsers `pptx/*` fflate + fast-xml-parser, `pdf/*` unpdf + @napi-rs/canvas, `questions/{csv,xlsx}`;
`gslides.ts` public export link with SSRF guard, Drive API behind `GOOGLE_DRIVE_IMPORT_ENABLED`;
`renderers/gotenberg.ts` when `GOTENBERG_URL`), `backend/src/workers/import.worker.ts` (Redis list +
BLMOVE + reaper; in-process with `IMPORT_WORKER_INPROCESS=1`), `frontend/features/imports/**`. PPTX
mapping: order from `presentation.xml` `sldIdLst`; title → heading; body → bullets/paragraph
(`a:lvl` nesting); picture-dominated → image; notesSlide → notes; charts/SmartArt/EMF/video →
warnings (+ rendered fallback if a renderer exists). PDF pages → image slides, text → notes + alt.

**W3-F AI whole-deck authoring.** `backend/src/modules/ai/deck/{deck.schema, deck.service,
slideMappers, prompts}.ts`, `frontend/features/ai/deck/**`. Light: `POST /api/ai/generate-deck` with
`authenticate()`, rate limit, `consumeUsage('ai_deck')`. Outline → slides with speaker notes; per-slide
repair via registry `safeParse`; response includes `source:'llm'|'mock'`.

**W3-G Workspace insights (optional).** `backend/src/modules/insights/**`
(`GET /api/insights?from&to`) + a tab on `app/(dashboard)/analytics`.

### Wave 4 — Epics 10, 11 (order: A → B → C → D → E)

**W4-A Accessibility + string extraction** (split by surface: participant / stage+presenter /
builder+library+settings+auth). Keyboard everywhere; focus moves to the new slide; `aria-live` for
timer milestones and results; `role="timer"`; correct/incorrect via icon + text; contrast from theme
tokens; reduced motion; 200% zoom; ≥44px targets; `@axe-core/playwright` specs;
`docs/compliance/a11y-checklist.md`. Acceptance: zero serious/critical axe findings on participant
and presenter core flows.

**W4-B Locales.** `frontend/messages/<locale>/**`, `frontend/i18n/{config,negotiate}.ts`,
`frontend/lib/proxy/locale.ts`, locale switcher. Light: `ApiError` gains `code`. Order: explicit
choice → `settings.audienceLocale` → Accept-Language → en. Acceptance: participant UI localizes for a
Spanish deck.

**W4-C GDPR, retention, anonymity.** `backend/src/modules/privacy/**` (`POST /api/me/export` zip via
fflate, to storage or streamed; `DELETE /api/me` with re-auth ≤5 min, soft delete → 30-day purge,
blocked while sole owner of a team workspace; `DELETE /api/sessions/:sid/participants/me`;
per-workspace retention job capped by plan; audit actor pseudonymization),
`frontend/features/privacy/**`, `settings/privacy`,
`docs/compliance/{anonymity,data-inventory,retention}.md`, `app/privacy/page.tsx` update.

**W4-D Embeds, oEmbed, add-in panes.** `backend/src/modules/embeds/**` (`GET /api/oembed`,
`POST|DELETE /api/embeds/screen-tokens` scoped to one deck), pages
`app/embed/{results/[token], live/[code], stage/[id]}` (chromeless, postMessage resize),
`app/addins/{powerpoint, teams/{config,sidepanel,stage}, zoom}`, `addins/powerpoint/manifest.template.xml`,
`addins/teams/{manifest.template.json, icons}`, `addins/zoom/README.md`,
`addins/scripts/build-manifests.ts`, `docs/integrations/*.md`. Light: `screen` role join;
`frame-ancestors *` for `/embed/*`, Zoom OWASP headers for `/addins/zoom`.

**W4-E Custom domains & white-label.** `backend/src/modules/domains/**` (CRUD + verify under
`/api/workspaces/:id/domains`, `GET /api/public/domains/resolve?host`,
`GET /api/public/domains/tls-ask?domain` for Caddy on-demand TLS; provisioners `none`, `vercel`,
`caddy`), `common/middlewares/cors.ts` (static allow-list + Redis set `domains:active`),
`frontend/lib/proxy/domains.ts` (non-primary host → workspace, cached 60s; only `/`, `/live/*`, `/r/*`,
`/embed/*`, `/_next/*`; `/` → branded join page; else 308 to primary), `settings/domains`,
`features/branding/PoweredBy.tsx` (hidden with `whiteLabel`).

## 3. Shared extension points (Wave 0)

| Extension point | File(s) | Contract |
| --- | --- | --- |
| Backend slide registry | `presentations/slides/registry.ts` | `SlideTypeDef {type; kind; lifecycle:'content'\|'response'\|'board'\|'system'; scored; schema: Zod; sanitize(slide); acceptConfig?(slide); answerSchema?; accept?(cfg, payload, {elapsedMs}) → {isCorrect, ops: RedisOp[], persist}; score?; distribution?(slide, raw); exportColumns?/exportCells?; label(slide)}`. `RedisOp` ∈ `hincrby`, `hsetnx`, `lpush_trim`. `sanitize` is an explicit allow-list, so notes and answer keys never leak. |
| Frontend slide registries | `slides/{runtime,editor,meta}.ts`; per type `{meta.ts, participant.tsx, stage.tsx, editor.tsx}` | Runtime `{ParticipantView({slide, mode, onSubmit, submitting}), StageView({slide, live, reveal, participants, mode:'live'\|'reveal'\|'report'\|'thumbnail'})}`; editor `{meta, blank(), Editor, validate, clean}`. Participants never download editor code. |
| Presentations module layout | `presentations.route.ts` → `routes/*.route.ts`; `live/*.service.ts` | One owner per sub-router/service file per wave. |
| Realtime | `common/realtime/{publish,rooms,registry,modules}.ts`, `events/*` | Envelope `{v, presentationId, sessionId, seq, type, payload, audience}`; `io.local` always; new types prefixed (`qna:`, `reaction:`, `remote:`, `presence:`, `slide:`, `session:`). Client events `live:join`, `live:leave`, `live:resync`, `answer:submit`. Roles `host`, `screen`, `participant`, `remote`, `editor`. |
| Frontend live store + slots | `live/{store,reducer,slots}.ts`, `features/registrations.ts` | `registerLiveReducer(prefix, fn)`. Slots: `participantTabs`, `participantFooter`, `participantBanner`, `participantBody`, `endScreen`, `stageOverlays`, `presenterPanels`, `hostToolbar`, `inspectorTabs`. |
| Tenancy | `common/tenancy/{workspaceContext.middleware,policy,roles}.ts` | `req.workspace` from `X-Workspace-Id` (must be a member) else the default workspace (lazy). Actions `deck:{create,read,edit,delete,host,share,export}`, `session:{read,export,share}`, `workspace:{manage,billing,members,sso,domains,brand}`. No `workspaceId` → `creatorId` fallback. |
| Plans | `common/plans/{plans,entitlements,usage,requireFeature}.ts` | `getEntitlements(ws)` = plan ⊕ `planOverrides`; `requireFeature(f)`; `assertLimit(ws,k,n)`; `consumeUsage(ws, counter)` (Redis monthly, mirrored to Mongo). Enforced with or without billing. |
| Capabilities | `common/config/env.ts`, `GET /api/capabilities` | Frontend disables unavailable features with an explanation. |
| Audit | `common/audit/audit.ts` | `audit(req, action, target, meta)`, fire-and-forget. |
| Jobs | `common/jobs/scheduler.ts` | `registerJob({name, everyMs, run})` with a Redis `NX PX` lock. |
| Storage | `common/storage/storage.ts`, `modules/uploads` | `enabled`, `presignPut`, `publicUrl`, `getObject`, `delete`; 503 when disabled. |
| Migrations | `src/migrations/runner.ts` | Number ranges; idempotent; `syncIndexes` inside migrations. |
| HTTP mounts | `backend/src/http/routes.ts` | Every module pre-stubbed. |
| Frontend proxy/headers/i18n/theme | `lib/proxy/index.ts`, `lib/security/headers.ts`, `i18n/*` + `messages/<locale>/<feature>.json`, `theme/tokens.css` | One file per feature; no shared string files. |
| Tests | `backend/tests/integration/harness.ts`, `frontend/e2e/**`, `frontend/tests/unit/**` | Real Mongo + Redis in CI; Playwright + axe. |

## 4. Risks and owner-account dependencies

**Technical risks:** deployment topology (sockets/timers/workers need long-lived processes; sticky
sessions or websocket-only transport for multiple instances); libraries that may not run under Bun
(gated by the W0-T spike); Redis key format change at W1-A1 (deploy with no live sessions);
no frontend tests before W0-C (characterization e2e first); write-behind loss (end-of-session
reconciliation); middleware traps (W0-T mount order); remote-control QR on a projected screen
(single-device binding + revocation); every new public endpoint gets a rate limit, participant
actions require the token, Q&A/reactions limited per participant.

**Needs the owner's accounts:**

| Feature | Setup |
| --- | --- |
| Stripe billing | Products/prices (`STRIPE_PRICE_*`), webhook secret, Customer Portal, tax |
| Storage | S3-compatible bucket (R2/S3) with CORS for presigned PUT and a public/CDN base URL. Without it: uploads, PPTX/PDF import and GDPR zip-to-storage are disabled; CSV/XLSX import and URL images still work. |
| High-fidelity PPTX | Gotenberg container (`GOTENBERG_URL`); otherwise editable text and images only |
| Google Slides private import | Google Cloud project with Drive API + Picker, API key, OAuth scope. Public share links work without it. |
| SAML/SCIM validation | IdP test tenants (Okta dev, Entra ID); automated tests use fixtures + Keycloak |
| PowerPoint add-in | M365 tenant for sideloading; AppSource needs Partner Center |
| Teams app | Tenant admin approval; store needs Partner Center; Teams SSO needs an Entra app |
| Zoom | Zoom Marketplace app (OAuth, domain allow-list); `/addins/zoom` inert until then |
| Custom domains | Vercel API token + project ID, or a Caddy host with on-demand TLS; DNS access |
