---
summary: Home (/home), the page a creator lands on: what is live, ways to start, the workspace's numbers, recent work and sessions.
status: active
last_updated: 2026-10-30
---

# Home

`/home` (`app/(dashboard)/home/page.tsx` → `features/home/components/HomeView.tsx`) is where a signed-in
creator lands (`HOME_PATH` in `lib/routes.ts`; see `core/routing-and-layouts.md` for every way in). It reads
existing endpoints only; nothing here has its own API.

## Sections, top to bottom

| Section | Source | Notes |
| --- | --- | --- |
| Header | auth store, browser clock | `meta-label` date, then "Good morning/afternoon/evening, *Name*" (the page's one serif word). Time and name render after mount (`useMounted`); the server renders "Welcome back". One ember action: New deck. |
| Live now | `GET /api/library?type=presentation&status=live&limit=3` and the insights `recentSessions` | Only when a deck is in its lobby or presenting. Drawn on the dark stage tokens (`className="dark"`) on graph paper: "Lobby open" or "Live now", the spaced join code, joined count and answer rate when the session is in the insights range, Open host console, Copy join link. More live decks link to the filtered library. |
| Start something | create modals, `ImportLauncher` | Blank deck, Quick poll, Generate with AI (the deck modal, whose AI start card leads on), Import (the imports dialog). |
| Last N days | `useInsights` | `HeadlineNumbers` with the analytics `RangeSwitch` (7, 30, 90 days) and a link to `/analytics`. |
| Recent work | `GET /api/library?limit=6` | The six cards edited last, as `LibraryCard`s (same menu and actions as the library); a link to the library when there are more. Empty state on graph paper. |
| Recent sessions, Top decks and polls | `useInsights` | The analytics components, unchanged. |

`features/home/hooks/useHomeLibrary.ts` loads both library slices in parallel, refetches when the workspace
changes and applies card removals and updates from the card menus. `features/home/greeting.ts` holds the pure
helpers (`greetingFor`, `firstName`, `todayLabel`, `spacedJoinCode`), unit tested in `tests/unit/home.test.ts`
with the sidebar's `activeNavHref`.

## Not here yet

A workspace-wide sessions page (the nav has no Sessions item until it exists), templates, and plan usage in
the sidebar are in the Graph paper 2.0 design but not built.
