---
summary: Verified vulnerability findings and a prioritized remediation plan. P0 items gate any public launch.
status: draft
last_updated: 2026-07-16
---

# Security Hardening Plan

> **Remediation status (2026-07-16, branch `security/hardening-p0-p1`):**
> P0 #1–#4 and P1 #5–#9 are fixed. #10 fixed alongside #1. Remaining open: #11–#14 (P2).
> Key new primitives: `backend/src/common/utils/signedId.utils.ts` (HMAC-signed ballot /
> guest / device tokens) and `backend/src/common/middlewares/security.middleware.ts`
> (security headers + Mongo-operator sanitization).

Findings below were verified by reading the cited source on 2026-06-10. Each has a file:line
anchor, the exploit, and the fix. **P0 = launch-gating.** For a polling/voting product, result
integrity *is* the value proposition — a tool whose votes can be stuffed is worth nothing to a
conference organizer, so the integrity items are not optional.

Severity: 🔴 High · 🟠 Medium · 🟡 Low

---

## P0 — Gate public launch

### 1. 🔴 Ballot stuffing via client-controlled `deviceId`
- **Where:** `backend/src/modules/responses/responses.service.ts:52-57`,
  schema `backend/src/modules/responses/responses.schema.ts:5`.
- **Exploit:** dedup key is `poll:{pollId}:voted:{deviceId}` where `deviceId` is supplied by the
  client in the request body. Rotate `deviceId` per request → unlimited votes. No IP fallback, no
  fingerprint, no auth requirement for anonymous polls.
- **Impact:** complete loss of result integrity. One actor can swing any anonymous poll.
- **Fix:** stop trusting `deviceId` as the sole identity. Layer defenses:
  - Bind to a **server-issued signed ballot token** (httpOnly cookie or signed token issued when
    the poll page loads), not a client-chosen string.
  - Add **IP + lightweight fingerprint** as a secondary dedup dimension (accepting NAT trade-offs,
    as the quiz limiter already documents).
  - For higher-stakes polls, offer an **auth-required** or **email-verified** mode.
  - Treat `deviceId` as a hint, never as the trust anchor.

### 2. 🔴 Identity spoofing on non-anonymous polls
- **Where:** `backend/src/modules/responses/responses.controller.ts:11`
  (`respondentId: req.user?.id || req.body.respondentId`); route uses `authenticate(true)`
  (optional) `backend/src/modules/responses/responses.route.ts:9`; service trust at
  `responses.service.ts:48`.
- **Exploit:** the route's auth is optional, so an unauthenticated caller can set `respondentId`
  to **any** value in the body — another user's ObjectId, or a forged `guest:victim@email:Name`.
  The "must be logged in to vote" check (`responses.service.ts:48`) only checks that *some*
  `respondentId` is present, not that it is authentic.
- **Impact:** vote attribution forgery, impersonation, poisoning of per-voter response lists
  (`getPollResponsesList`).
- **Fix:** for non-anonymous polls, require real authentication (`authenticate()` not optional) and
  derive `respondentId` **only** from `req.user.id` — never from the body. For guest mode, issue and
  verify a signed guest token (email-verified) rather than accepting a self-asserted `guest:` string.

### 3. 🔴 No rate limiting on auth endpoints
- **Where:** `backend/src/modules/auth/auth.route.ts` (login/register/forgot-password/
  resend-verification have no `rateLimit` middleware; only AI + quiz public routes do —
  `backend/src/modules/ai/ai.route.ts:21`, `backend/src/modules/quizzes/quizzes.route.ts`).
- **Exploit:** unlimited credential brute-force / stuffing on login; unlimited password-reset and
  verification emails (`forgotPassword`, `resendVerification` in
  `backend/src/modules/auth/auth.controller.ts:63,85`) → account takeover surface + email bombing
  + provider reputation damage.
- **Fix:** add the existing `rateLimit` middleware to all auth routes (tight limits, e.g.
  login 10/15min/IP, forgot-password 5/hr/IP+email). Add exponential backoff / lockout on repeated
  login failures per account. Consider CAPTCHA on repeated failure.

### 4. 🟠 Non-atomic vote dedup race (promote to P0 with #1)
- **Where:** `backend/src/modules/responses/responses.service.ts:53-57` — `redisClient.get(spamKey)`
  then `redisClient.setEx(...)`.
- **Exploit:** two concurrent requests with the same key both pass the `get` before either `setEx`
  lands → double vote. Trivially weaponized with parallel requests.
- **Fix:** single atomic `SET spamKey value NX EX 86400`; treat "not set" as the first-and-only vote.
  (The quiz answer path already does this correctly with `SADD` — mirror that pattern.)

---

## P1 — Before onboarding real customers

### 5. 🟠 Socket.io has no room authorization
- **Where:** `backend/src/common/realtime/socket.ts:23-43` — any connected client can
  `socket.join('quiz_<anyId>')` / `poll_<anyId>` with no check.
- **Exploit:** any client subscribes to any poll's live analytics or any quiz's event stream
  (privacy leak for private/unlisted polls); room-join is also an unauthenticated amplification/
  resource vector. Quiz broadcasts are answer-key-sanitized (good), but poll analytics and presence
  are not access-controlled.
- **Fix:** authenticate the socket handshake; authorize room joins (participant token for quiz
  rooms, ownership/share-scope for poll analytics rooms). Add per-connection join rate limits.

### 6. 🟠 Missing baseline HTTP hardening (helmet, sanitization)
- **Where:** `backend/src/app.ts` — no `helmet`, no `express-mongo-sanitize`, no `hpp`
  (grep confirmed none present).
- **Exploit:** no security headers (clickjacking on host/play pages via missing
  `X-Frame-Options`/CSP; no HSTS; no `X-Content-Type-Options`). No NoSQL-operator stripping — JSON
  bodies containing `$`/`.` operators can reach Mongo filters (e.g. `deviceId` in the quiz join
  `findOneAndUpdate` filter `quizzes.service.ts:561`, `respondentId` in `$in` lookups).
- **Fix:** add `helmet` with a sane CSP, `express-mongo-sanitize` (or explicit per-field
  validation/casting), and frame-busting on presenter/participant pages. Validate/cast all IDs to
  `ObjectId` before they enter a query.

### 7. 🟠 Access token exposed in OAuth redirect URL
- **Where:** `backend/src/modules/auth/auth.controller.ts:135` (token in querystring) and the bridge
  `backend/src/app.ts:60-70`; partial token logged at `app.ts:68`, `auth.controller.ts:137`.
- **Exploit:** tokens in URLs leak into server access logs, browser history, and `Referer` headers
  sent to third parties on the landing page.
- **Fix:** exchange a short-lived, single-use code at the callback (server sets the session cookie,
  redirects with no token in the URL), or deliver via URL fragment consumed and stripped client-side.
  Stop logging token material entirely.

### 8. 🟠 Quiz participant sybil via client-chosen `deviceId`
- **Where:** `backend/src/modules/quizzes/quizzes.service.ts:561` — join upsert is keyed on
  client-supplied `deviceId`.
- **Exploit:** one actor rotates `deviceId` to spawn many participants (leaderboard/word-cloud
  stuffing); knowing another player's `deviceId` lets you re-join *as them* (the token mitigates
  answer submission, but identity creation is attacker-controlled).
- **Fix:** issue the device/participant identifier server-side (signed) at first join rather than
  trusting a client string; rate-limit joins per IP (already partially done) and per session.

### 9. 🟠 Public poll read leaks unpublished drafts
- **Where:** `backend/src/modules/polls/polls.route.ts:12` — `GET /api/polls/:id` is
  unauthenticated and returns the full poll (including `isPublished=false` drafts and all questions).
- **Exploit:** anyone with (or guessing/enumerating) an ObjectId reads private draft polls.
- **Fix:** for unauthenticated reads, return only published/active polls; require ownership for
  drafts. Consider unguessable share slugs instead of raw ObjectIds for public links.

---

## P2 — Hardening & hygiene

### 10. 🟡 Mock placeholder in the production response path
- **Where:** `backend/src/modules/responses/responses.service.ts:73` —
  `respondentId: payload.respondentId ?? 'mock-respondent-123'`.
- **Fix:** persist a real anonymous marker (or null) instead of a literal placeholder; anonymous
  votes currently all collapse to one fake id.

### 11. 🟡 Cookie-token auth path invites CSRF / is inconsistent
- **Where:** `backend/src/modules/auth/auth.middleware.ts:21` trusts a `token` cookie; login only
  ever sets `refreshToken` (`auth.controller.ts:31`). `sameSite: 'lax'` mitigates most CSRF.
- **Fix:** decide one model. If any state-changing endpoint accepts cookie auth, add CSRF protection
  (double-submit token or `SameSite=strict` + origin check). Otherwise drop the cookie-`token`
  branch and use `Authorization: Bearer` exclusively.

### 12. 🟡 Rate limiter fails open and is IP-only
- **Where:** `backend/src/common/middlewares/rateLimit.middleware.ts:33-35`.
- **Note:** fail-open is a deliberate availability choice, but it means a Redis outage removes *all*
  throttling — including the auth limits added in #3. IP-only keying is bypassable via rotating IPs.
- **Fix:** keep fail-open for participant routes; for **auth** routes prefer fail-closed (or a local
  in-memory fallback) and key on IP **and** account/email where applicable. Alert on Redis-down.

### 13. 🟡 User enumeration on auth flows — **verify**
- **Where:** `backend/src/modules/auth/auth.service.ts` (not read in this pass).
- **Action:** confirm whether register/login/forgot-password return distinct messages for
  existing-vs-unknown emails. If so, return uniform responses ("if an account exists, we sent…").

### 14. 🟡 Secrets & config validation
- **Where:** `backend/src/common/utils/jwt.utils.ts:6-13` correctly throws on missing prod secrets
  (good). But there is no central env validation (e.g. zod) for `MONGO_URL`, `REDIS_URL`,
  `FRONTEND_URL`, mail creds, OAuth creds.
- **Fix:** validate all required env at boot; fail fast with a clear message.

---

## Suggested remediation order

1. **Sprint 1 (P0):** #1, #2, #3, #4 — vote integrity + identity + auth rate-limit. Ship before any
   real audience touches the system.
2. **Sprint 2 (P1):** #5, #6, #7, #8, #9 — socket authz, helmet/sanitize, OAuth token handling,
   quiz sybil, draft-leak. Before onboarding paying customers.
3. **Sprint 3 (P2):** #10–#14 — hygiene + CSRF decision + env validation + enumeration audit.

## Standing rules to adopt (compound the fixes)

- **Never trust client-supplied identity** (`deviceId`, `respondentId`, `participantId` without a
  matching server-issued token). Server issues identity; client echoes it back with proof.
- **Every dedup/uniqueness check is atomic** (`SET NX` / `SADD`), never read-then-write.
- **Every new public endpoint gets a rate limit** (already a quiz-roadmap standing constraint —
  extend it to auth and responses).
- **Every new socket room join is authorized.**
- Add these as review-checklist items so new features inherit them automatically.
