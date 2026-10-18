---
summary: Phased roadmap for the live quiz / interactive presentation feature (Mentimeter parity).
status: active
last_updated: 2026-06-10
---

# Quiz Feature Roadmap

Single source of truth for what's shipped and what's next. One phase = one shippable
increment. Keep order — later phases assume earlier infrastructure.

---

## ✅ Phase 1 — Core quiz competition (SHIPPED 2026-06-10)

Slide types `select_answer` + `type_answer`; presenter-paced state machine
(`draft → lobby → question ⇄ reveal ⇄ leaderboard → ended`); 6-digit join codes;
nickname join (no account); server-clock speed scoring (full→50% decay, toggle);
cumulative leaderboard; final standings; builder/host/play UIs.

## ✅ Phase 2 — Security + scale hardening (SHIPPED 2026-06-10)

Participant token auth (anti-spoofing); Redis per-IP rate limiting (multi-instance,
fails open); Redis-first answer hot path (session cache, SADD dedup, ZSET leaderboard,
dist/results hashes, Mongo write-behind) — verified ~1100 answers/sec single instance;
QR deep link on host lobby; socket CORS locked to FRONTEND_URL; CastError→400.

---

## ✅ Phase 3 — Non-scored interactive slide types (SHIPPED 2026-06-10)

Slide types `wordcloud`, `open_ended`, `scales` (1–N statements, min/max labels,
scaleMax 2–10), `ranking` (2–10 items) added as a flat schema + per-type Zod
`superRefine` (one Mongoose subdoc schema, unused fields default empty). Non-scored:
score=0, no leaderboard delta, results hash carries a `scored` flag so participants see
"response received" instead of correct/wrong. Dist storage in `quiz:{id}:dist:{slide}`:
wordcloud/open_ended → normalized text counts + parallel `quiz:{id}:disp:{slide}` hash for
first-seen original casing; scales → per-statement `s{i}:sum`/`s{i}:count` (avg at
reveal); ranking → Borda points per item + `voters` counter. Wordcloud accepts up to
`maxEntries` (1–3) words in ONE submission (single SADD dedup — simpler than `pid:n`).
Builder type-picker grid (Mentimeter panel layout), per-type editors, per-type play
inputs (chips / textarea / sliders / up-down reorder list — no dnd dep), host reveal
renderers (sized word cloud, card wall, averaged bars, ranked Borda list).

## ✅ AI quiz generation (pulled forward from Phase 8, SHIPPED 2026-06-10)

`POST /api/ai/generate-quiz` (authenticate + rate limit 20/5min): topic, slideCount
(1–15), allowed slideTypes, tone → Gemini structured output on a flat slide schema,
then per-slide repair/validation against `quizSlideSchema` (irreparable slides dropped,
mock fallback without API key). Frontend: sidebar "Create Quiz" opens a title modal
(manual / AI), AI mode opens `AiQuizModal` in the builder and fills slides into state
for review before save. Unified dashboard: `/polls` has a Polls/Quizzes switcher with
quiz stats + cards.

## 🔜 Phase 4 — Advanced scored types

**Goal:** Guess the Number, 100 Points, 2x2 Grid, Pin on Image.

- `guess_number`: numeric input; score by closeness — `points * max(0, 1 - |guess-answer|/range)`;
  reveal shows distribution histogram + correct value marker.
- `100_points`: allocate 100 across options (validation: sum=100); reveal shows averages.
  Optional scoring: dot product with host's "correct" allocation.
- `2x2_grid` / `pin_on_image`: store `{x,y}` (image upload dependency → Phase 5);
  reveal = scatter overlay; pin scoring by radius from target (optional).
- Dist storage: histogram buckets / running sums / coordinate list (capped, sampled
  beyond 1k points).

**Acceptance:** each type playable, revealable, scorable where defined; schema rejects
malformed payloads (sum≠100, out-of-range pins).

## 🔜 Phase 5 — Presenter & content UX

- **Media on slides:** image upload (S3-compatible or Cloudinary; signed upload from
  builder; store URL on slide; render on host + play).
- Slide management: reorder (drag), duplicate, per-slide preview in rail.
- Host controls: pause/extend timer (+30s → update `questionEndsAt` + republish timing),
  skip slide, kick participant (DEL from Redis hashes + `participant:kicked` event),
  per-slide "show correct answer" toggle.
- Lobby polish: fullscreen toggle, countdown-to-start animation, sound cues
  (start/tick/reveal — muteable), nickname profanity filter (wordlist) at join.
- Quiz themes (color presets) stored on Quiz doc.

**Acceptance:** host can run a full session without leaving fullscreen; timer extension
reflected on all clients within 1s.

## 🔜 Phase 6 — Transport & horizontal scale

- Move answer submission to Socket.io with ack (`quiz:answer` event) — saves HTTP
  handshake per click; keep REST endpoint as fallback.
- Add `@socket.io/redis-adapter` so rooms span instances (currently only pub/sub fan-out).
- Coalesce `answer:received` broadcasts (max 4/sec per quiz; flush on reveal) — N answers
  × M listeners currently O(N·M).
- Single Lua script (or MULTI) for the answer pipeline (session check + SADD + ZINCRBY +
  HINCRBY) → 1 round trip, fully atomic under concurrency.
- k6/artillery load script in repo + CI smoke (target: 2k answers/sec, p95 < 150ms).
- Metrics: per-route latency histogram, Redis op timing, socket room sizes (`/metrics`
  Prometheus endpoint).

**Acceptance:** 2 backend instances behind a proxy run one quiz correctly; load target met.

## 🔜 Phase 7 — Sessions, history & export

- **QuizSession entity** — currently `open-lobby` wipes the previous run. Snapshot each
  run: `{ quizId, startedAt, endedAt, participantCount, finalLeaderboard[], perSlideStats[] }`;
  participants/answers reference sessionId.
- Creator history UI: past runs list per quiz, per-run report (per-question accuracy,
  hardest question, fastest player).
- Export: CSV (participants × questions matrix) + shareable read-only results link.
- Participant take-home: `/quiz/result/[sessionId]/[participantId]` summary page.

**Acceptance:** running a quiz twice preserves both runs; CSV matches Redis/Mongo totals.

## 🔜 Phase 8 — Engagement extras (backlog, order flexible)

- Team mode (auto/manual teams, team leaderboard = sum or avg).
- Streak bonuses (+10% per consecutive correct, cap 50%) — flag on Quiz.
- Live reactions (emoji burst, rate-limited, ephemeral — Redis pub/sub only, no storage).
- Audience Q&A slide with upvoting + host moderation queue.
- Import slides (CSV/JSON). (AI quiz generation already shipped — see above.)
- i18n for participant-facing strings.

---

## Standing constraints (apply to every phase)

- Answer-path work stays Redis-first; Mongo only async write-behind.
- Never send answer keys to participants before reveal (sanitize at the service layer).
- All realtime via `publishLiveEvent` (live envelope on Redis pub/sub) — no direct `io.emit` from services.
- Every new public endpoint gets a rate limit; every new participant action requires the
  participant token.
- Update this file + `modules/presentations.md` + `realtime/presentations.md` when a phase ships.
