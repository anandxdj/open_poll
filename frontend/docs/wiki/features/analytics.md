---
summary: Analytics pages, real-time WebSocket event contract, and aggregate metrics spec.
status: active
last_updated: 2026-10-25
---

# Analytics Feature

## Pages

Both pages follow the app-screen rules in `ui/design-system.md` (page header, hairline count strip,
underline tabs, white sheets) and the dataviz rules below.

### Analytics overview (`/analytics`)
- **Route**: `app/(dashboard)/analytics/page.tsx`.
- Polls of the current workspace from `useCreatorStore().fetchPolls()`, then each poll's
  `GET /responses/poll/:id/summary` for its response count.
- Count strip: Polls, Responses, Live now (published, not closed, not expired).
- "Responses per poll": a ranked bar list (most answered first, one ember hue, the value at each bar's
  tip, status dot and question count beside the title). Every row links to `/analytics/[id]`. Empty state
  on graph paper with "New poll".

### Per-poll analytics (`/analytics/[id]`)
- **Route**: `app/(dashboard)/analytics/[id]/page.tsx`.
- Fetches the poll and its summary on mount, then follows `poll:{id}` over Socket.io for live counts.
- Header: back link, title, "Results are public" when published; actions "Copy poll link" and
  "Publish results" (`POST /polls/:id/publish-results`), or "Share on X" and "Copy poll link" once public.
- `AnalyticsHeaderStats`: Responses, Status (Live / Closed / Expired, with when), Respondents (Anonymous /
  Identified), Created.
- Tabs **Results** and **Voters** (count). Results: `TopChoiceHighlight` (the leading answer as one
  sentence), the `VisualizationPicker` (Bars by default, Columns, Donut, List; a segmented control of
  `aria-pressed` buttons) and one `QuestionAnalytics` per question. Assessments (`pollType: TRIAL`) pass
  `correctOptionIndices` and `explanation`, shown as a check, the word "Correct" and the success colour.
- Voters: `GET /responses/poll/:id/list` on opening the tab; search by name or email, filter by type
  (Everyone / Registered / Guests / Anonymous), a table with "View answers" per row.

### Chart rules (`QuestionAnalytics`)
- One series per question: every bar in `--chart-1` (ember); bars at most 24px with a 4px rounded end;
  hairline solid grid in `--border`; the count at each bar's tip in `--muted-foreground`; tooltips lead
  with the value, then the option.
- Donut: the categorical tokens `--chart-1..6` in fixed order, a 2px `--card` stroke between slices, a
  legend with values beside it; options past the sixth fold into "Other".
- The chart tokens were checked with the dataviz palette validator in both themes (lightness band,
  chroma floor, colour-blind and normal-vision separation, 3:1 against the card).

## WebSocket Event Contract

Socket.io server (backend) emits events to rooms named `poll:{pollId}`.

### `analytics:update` (server → client)
Emitted whenever a new response is submitted.

```ts
type PollAnalyticsPayload = {
  pollId: string;
  totalResponses: number;
  questionSummaries: {
    questionId: string;
    counts: number[];      // one count per option, index-aligned with poll.questions[i].options
  }[];
  emittedAt: string;       // ISO 8601
};
```

### `poll:vote` (server → client) — future
May be emitted for individual vote events (not yet used on frontend).

## Hooks

### `useSocketListener`
Located: `features/analytics/hooks/useSocketListener.ts`

Usage:
```ts
useSocketListener({
  pollId: string | undefined,
  enabled: boolean,
  onUpdate: (payload: PollAnalyticsPayload) => void,
});
```
Connects to the Socket.io server, joins `poll:{pollId}` room, and calls `onUpdate` on `analytics:update` events.

## Components

`features/analytics/components/`: `AnalyticsHeaderStats`, `TopChoiceHighlight`, `VisualizationPicker`,
`QuestionAnalytics` (described above). `AnalyticsOverview.tsx` is not used by any page.

## Data Fetching

- Summary endpoint: `GET /responses/poll/:id/summary` → returns `PollAnalyticsPayload`
- Voter list: `GET /responses/poll/:id/list` (authenticated, workspace members who can read the poll)
- All polls: `useCreatorStore().fetchPolls()` (current workspace)
- Publish results: `POST /polls/:id/publish-results`