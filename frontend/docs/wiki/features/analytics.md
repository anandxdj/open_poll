---
summary: The analytics pages, /analytics (workspace insights + responses per poll) and /analytics/[id] (one poll's results and voters).
status: active
last_updated: 2026-10-26
---

# Analytics (`app/(dashboard)/analytics`, `features/analytics/`)

## `/analytics`: workspace overview

Data: `GET /api/insights` (backend `modules/insights.md`) through `features/analytics/insights.ts`
(`fetchInsights`, wire types) and `hooks/useInsights.ts` (keeps the last range's data while a new one
loads, refetches on workspace change, `retry`). Days are counted in the viewer's time zone
(`viewerTimeZone()`, sent as `tz`).

Top to bottom (`components/InsightsOverview.tsx`):

| Part | What it shows |
| --- | --- |
| Header | h1, one sentence, "N sessions and M polls live now" (`LiveNow`, hidden when nothing runs), the range switch (`RangeSwitch`: 7 / 30 / 90 days, a segmented control of pressed buttons) |
| `HeadlineNumbers` | Sessions, Participants, Responses, Engagement as one hairline strip; under each the change against the previous period of the same length: a green/red/grey arrow, the amount in mono ink (`countChange`: a percentage, or the plain difference after an empty period; `rateChange`: percentage points), "vs previous N days"; "Nothing to compare yet" when both are empty |
| `ActivityChart` | one series per day (Participants, Responses or Sessions, picked with a segmented control; one axis, one hue `--chart-1`), hover tooltip with the date and all three numbers (the picked one strong), the period total in the sentence above; a quiet line when the range is empty |
| `TopContent` | up to 6 decks (by participants, link to the deck's sessions) and polls (by responses, link to `/analytics/[id]`) as ranked hairline rows with a thin share bar |
| `RecentSessions` | the 6 latest sessions, link to the report; live ones carry the Live pill, ended ones their answered share |
| Responses per poll | every poll, all time, ranked bar list (per-poll summaries); opens `/analytics/[id]` |

Loading shows placeholders in place; a failed first load shows a retry line. The design follows
`ui/design-system.md` (App screens): flat bordered sheets, tabular numbers, one accent.

## `/analytics/[id]`: one poll

Header with copy-link / publish actions, a stat strip, Results / Voters underline tabs, the chart
picker (`VisualizationPicker`), `TopChoiceHighlight` and one `QuestionAnalytics` card per question;
counts update live over the socket (`hooks/useSocketListener.ts`).

## Tests

`tests/unit/analytics.insights.test.ts` (range, change, formatting helpers),
`tests/unit/analytics.overview.test.tsx` (headline numbers and changes, links, live pill, empty
states), `e2e/analytics.spec.ts` (the page against the real API, range and series switches).
