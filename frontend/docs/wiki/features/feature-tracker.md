# Feature Tracker

This document tracks the features we have already implemented and the features we still need to build.

## ✅ Implemented Features
- **Design Specification**: Established strict UI constraints (design-system.md). Double-Bezel + Amber design system.
- **Double-Bezel Dashboard Shell**: The core nested layout architecture (`app/(dashboard)/layout.tsx`).
- **Kinetic Sidebar + Island Architecture**: Navigation sidebar with fluid motion, Analytics nav item, and theme toggling.
- **Poll Builder (UI Phase)**: Functional poll creation form — title, expiry, anonymous toggle, question stack, AI draft generation.
- **PollCard Component**: Displays poll status (Active / Expired / Draft) with CTA to analytics.
- **Dashboard Page (`/polls`)**: Stat cards (Total Polls, Total Votes, Active Polls) + poll grid.
- **Per-Poll Analytics (`/analytics/[id]`)**: Live bar charts with WebSocket updates via `useSocketListener`.
- **AI Poll Generation**: AiPromptModal with Gemini-backed draft generation.
- **Live Quiz Competitions (Phases 1–2)**: `features/quizzes/` + routes `/quizzes` (list),
  `/quiz/create` (slide builder: select/type answer, correct-answer marking, time limit,
  points, speed-bonus toggle), `/quiz/host/[id]` (fullscreen presenter: lobby with join
  code + QR deep link, server-synced timer, reveal charts, animated leaderboard, podium),
  `/quiz/join` + `/quiz/play/[code]` (participant: nickname join, colored answer buttons,
  personal result + rank after reveal). Participant secret token stored in localStorage;
  realtime via `quiz:event` socket envelope. Sidebar "Quizzes" nav item.
- **Quiz Phase 3 — Interactive slide types + AI generation + unified dashboard**:
  4 non-scored Mentimeter types (Word Cloud, Open Ended, Scales, Ranking) with builder
  type-picker grid (`SlideTypePicker`), per-type editors, per-type play inputs (word
  chips, textarea, sliders, up/down reorder), host reveal renderers (sized word cloud,
  card wall, averaged bars, Borda ranked list). Sidebar "Create Quiz" → `CreateQuizModal`
  (title → manual or AI); `AiQuizModal` calls `POST /api/ai/generate-quiz` and fills the
  builder. `/polls` dashboard unified with a Polls/Quizzes switcher (quiz stats + shared
  `QuizCard`).
- **Quiz UI folded into presentation decks**: `features/quizzes/` and the `/quiz/*` +
  `/quizzes` routes are gone; everything above now lives in `features/presentations/`
  (`PresentationBuilder`, `HostView` → now `components/host/HostConsole`, `PlayView` → now
  `components/participant/ParticipantShell`, `PresentationCard`,
  `CreatePresentationModal`) at `/presentation/create`, `/presentation/host/[id]`, `/live`
  and `/live/[code]`. The host QR code points at `/live/{joinCode}`. Old `/quiz/...` URLs
  308-redirect to their equivalents (`next.config.ts`), query string included.
- **Live surfaces extension points (W0-C1)**: host console = Stage + host controls,
  participant shell, per-surface zustand live store with a pure reducer and module
  sub-reducers, slots, the slide runtime registry (`participant.tsx`/`stage.tsx` per type,
  builder thumbnails via `StageView mode="thumbnail"`), `--deck-*` theme tokens, next-intl
  for live routes, Playwright e2e + unit tests. Detail: `live-surfaces.md`.
- **Unified library (`/polls`)**: `features/library/` — polls and decks as one card list from
  `GET /api/library` (type tabs, status filter, search, URL filters, infinite scroll), per-card
  actions, "Convert to presentation" for polls; `/presentations` redirects to
  `?type=presentation`; sidebar item renamed "Library".

## 🚧 Features In Progress / To Implement

### Poll Builder Redesign — Mentimeter-Style (`/create`)
- **Two-panel layout**: Left = question list (add/select/reorder), Right = phone-frame live preview.
- **PollSettings panel**: Title, description, response mode (Anonymous / Authenticated), expiry picker, publish results toggle.
- **QuestionEditor**: Options CRUD (add/remove up to 10), mandatory/optional toggle, character counter.
- **LivePreview**: Phone-frame mockup that updates in real time as the creator types.
- **Top toolbar**: Save Draft | Preview | Publish CTA.

### Dashboard Redesign (`/polls`)
- Hero section with animated stat tiles (Total Polls, Live Votes, Active Polls, Avg. Completion).
- PollCard v2: expiry countdown badge, response mode chip (Anonymous / Auth), "Publish Results" action.
- Live vote counter on active poll cards (WebSocket).

### Analytics Overview (`/analytics`)
- New top-level analytics page with aggregate metrics across all polls.
- Response rate sparkline chart, top polls by response count, "Live now" indicator.

### Public Voting Interface (`/p/[id]`)
- Respondent-facing voting page.
- Mandatory/optional question validation on submit.
- If poll is `Authenticated` mode: name/email form shown before questions.
- Expiry guard: block voting if poll has expired.
- Show results page after voting if creator has published results.

### Real-Time Live Updates
- Live response count on PollCards (WebSocket room per poll).
- Live vote counter on Analytics Overview page.

### Advanced State / Storage
- Robust caching for device IDs and offline capabilities.

### Live Quiz — Upcoming Phases (detail: `backend/docs/wiki/quiz-roadmap.md`)
- **Phase 3**: non-scored interactive slides — Word Cloud, Open Ended, Scales, Ranking
  (type picker grid in builder, per-type play inputs, host reveal renderers).
- **Phase 4**: advanced scored types — Guess the Number, 100 Points, 2x2 Grid, Pin on Image.
- **Phase 5**: presenter UX — slide images, reorder/duplicate, pause/extend timer,
  kick participant, sounds, themes, nickname profanity filter.
- **Phase 6**: socket-based answer submission + multi-instance socket adapter,
  coalesced broadcasts, load-test CI.
- **Phase 7**: session history per run, per-question reports, CSV export,
  participant take-home result page.
- **Phase 8**: team mode, streaks, reactions, audience Q&A, slide import, AI quiz generation.

*(Add new feature requests here)*
