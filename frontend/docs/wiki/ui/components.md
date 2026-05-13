---
summary: Reusable component inventory, props contracts, and usage guidelines.
status: active
last_updated: 2026-05-13
---

# Component Reference

## Layout Components

### `Sidebar` (`components/layouts/Sidebar.tsx`)
- Icon-only below `lg`, full label above `lg`.
- Nav items: Dashboard (`/polls`), New Poll (`/create`), Analytics (`/analytics`).
- Footer: theme toggle (Button-in-Button pattern) + user avatar + role label.
- Active indicator: Framer Motion `layoutId="activeNav"` gradient overlay.

### `Navbar` (`components/layouts/Navbar.tsx`)
- Displays route-scoped page title (no duplicate brand name).

---

## Poll Feature Components

### `PollCard` (`features/polls/components/PollCard.tsx`)
Displays a single poll in the dashboard grid.

**Props**: `{ poll: Poll }`

**Displays**:
- Poll title (line-clamp-2)
- Status badge: Active (orange) / Expired (muted) / Draft (muted)
- Response mode chip: Anonymous (neutral) / Auth Required (amber)
- Expiry countdown (for active polls): "Closes in Xh Ym"
- Question count
- "Publish Results" button (shown when poll is expired/closed and results not yet published)
- "View Analytics" CTA → `/analytics/[id]`

---

### `PollBuilder` (`features/polls/components/PollBuilder.tsx`)
Top-level orchestrator for the `/create` page. Manages all draft state.

**Internal structure**:
- `CreatePollHeader` — page title + AI Generate button
- `PollBasicsCard` (aka `PollSettings`) — title, expiry, mode, published toggles
- `PollQuestionsPanel` — question list + add button
- `PollQuestionCard` — individual question editor (collapsible)
- `CreatePollFooter` — Cancel + Save CTA

---

### `PollQuestionsPanel` (`features/polls/components/create/PollQuestionsPanel.tsx`)
Renders the full list of question cards. Includes "Add question" pill button at top-right.

### `PollQuestionCard` (`features/polls/components/create/PollQuestionCard.tsx`)
Single question editor card (Double-Bezel). Collapsible via chevron toggle.

**Features**:
- Drag handle (visual only, `GripVertical`)
- Question number badge
- Prompt (text input, `rounded-2xl`)
- Required / Optional switch (`isMandatory`)
- Options list: numbered inputs, Add choice + Remove buttons
- Remove question button (disabled when only 1 question)
- Active state: outer shell gets `ring-1 ring-yellow-400/30`

### `PollBasicsCard` (`features/polls/components/create/PollBasicsCard.tsx`)
Settings card (Double-Bezel). Sticky on desktop.

**Fields**:
- Poll title input
- Closes at (datetime-local input)
- Anonymous responses (Switch)
- Published (Switch)

---

## Analytics Components

### `LiveBarChart` (`features/analytics/components/LiveBarChart.tsx`)
Recharts bar chart for per-question option vote counts.
- Props: `{ title: string; data: { label: string; votes: number }[] }`
- Orange bars (`#f97316`), animated on data update (450ms ease-out).

### `AnalyticsOverview` (`features/analytics/components/AnalyticsOverview.tsx`) — **NEW**
Aggregate metrics panel for the `/analytics` overview page.
- Total votes across all polls
- Active polls count with "Live now" badge
- Top 5 polls by response count (ranked list)

---

## AI Components

### `AiPromptModal` (`features/ai/components/AiPromptModal.tsx`)
Modal triggered from `CreatePollHeader`. Submits a text prompt to Gemini via `generateDraft` API. On success, calls `onApplyDraft(draft)` to populate the builder form.