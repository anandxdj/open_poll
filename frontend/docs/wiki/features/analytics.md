---
summary: Analytics pages, real-time WebSocket event contract, and aggregate metrics spec.
status: active
last_updated: 2026-05-13
---

# Analytics Feature

## Pages

### Per-Poll Analytics (`/analytics/[id]`)
- **Route**: `app/(dashboard)/analytics/[id]/page.tsx`
- Fetches poll data and response summary from backend on mount.
- Subscribes to Socket.io room `poll:{id}` for live updates.
- Renders `LiveBarChart` per question.
- Displays total response count (live-updating via WebSocket).
- **Publish Results button**: Calls `POST /polls/:id/publish-results` to flip `isResultsPublished`.

### Analytics Overview (`/analytics`)
- **Route**: `app/(dashboard)/analytics/page.tsx` ← **NEW**
- Aggregate metrics across all creator polls:
  - Total votes across all polls
  - Number of currently active polls (with "Live now" badge)
  - Top 5 polls by response count
  - Response trend (basic sparkline)
- Fetches all polls, then fetches summaries for each.
- Shows real-time "Live now" indicator for polls whose socket room is active.

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

### `LiveBarChart`
Located: `features/analytics/components/LiveBarChart.tsx`
Props: `{ title: string; data: { label: string; votes: number }[] }`
Uses Recharts `BarChart`. Orange (`#f97316`) bars with rounded tops and 450ms animation.

### `AnalyticsOverview` — **NEW**
Located: `features/analytics/components/AnalyticsOverview.tsx`
Renders the aggregate metrics view for the `/analytics` overview page.

## Data Fetching

- Summary endpoint: `GET /responses/poll/:id/summary` → returns `PollAnalyticsPayload`
- All polls: `GET /polls?creatorId=mock-creator-id-123`
- Publish results: `POST /polls/:id/publish-results` (to be confirmed with backend)