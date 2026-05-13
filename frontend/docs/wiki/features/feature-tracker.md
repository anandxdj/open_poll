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
- *(Add new feature requests here)*
