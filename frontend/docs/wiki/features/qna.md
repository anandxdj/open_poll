---
summary: Audience Q&A and emoji reactions on the live surfaces — state slice, slots, host moderation, the Q&A slide, the builder's Audience tab, wire usage and tests.
status: active
last_updated: 2026-10-19
---

# Q&A and reactions (`features/qna/`, `features/reactions/`)

Participants ask and upvote questions and send emoji; the host moderates and puts a question on the
stage. Backend contract: `backend/docs/wiki/modules/qna.md` (API, rules, limits) and
`backend/docs/wiki/realtime/qna.md` (events). Everything plugs into the live surfaces through the
extension points of [`live-surfaces.md`](./live-surfaces.md); neither feature edits the live store,
host console, participant shell or stage.

## Wiring

`features/registrations.ts` imports `qna/register` and `reactions/register`, which call
`registerQnaModule()` / `registerReactionsModule()` (`module.ts`; each returns an undo function,
which the unit tests use so registrations do not leak between test files).

| Slot / registry | Entry | What it renders |
| --- | --- | --- |
| `registerLiveReducer('qna')` | `qnaReducer` (`qna/state.ts`) | The question slice, see below. |
| `registerLiveReducer('reaction')` | `reactionReducer` (`reactions/state.ts`) | The latest coalesced `reaction:burst` (`{burstId, counts}`). |
| `participantTabs` `qna` | `QnaTab` → `QnaPanel` | The Q&A tab. Shown unless the deck is known not to use Q&A (`qna/tabAvailability.ts`: a small cache the loader fills; `when` has no store access and runs at render, so an unknown deck counts as available). |
| `participantBanner` `qna-sync` | `QnaParticipantSync` | Invisible: loads the list, bridges participant-addressed events (below), tells the tab cache. |
| `participantFooter` `reactions` | `ReactionsBar` | One button per allowed emoji; emits `reaction:send` on the shared socket (`lib/socket`). |
| `hostToolbar` `qna` | `HostQnaDrawer` | Header button with the pending count and the moderation drawer (Esc closes; keys typed inside do not reach the console's slide shortcuts). |
| `presenterPanels` `qna` | `PresenterQnaPanel` | The same `HostQnaPanel`, for W2-A's presenter console. |
| `stageOverlays` `qna-highlight`, `reactions` | `HighlightOverlay`, `ReactionsOverlay` | The question the host put on screen; emoji floating up (a batch per burst, capped at 24, 60 alive; reduced motion fades in place). |
| Slide registries | `slides/types/qna/*` | The `qna` slide type, lifecycle `board`. |
| `inspectorTabs` | `qna/builder/AudienceTab` | Builder tab "Audience" (deck-level). |

## State (`state.ts`)

`state.modules.qna`: `{loaded, sessionId, settings, reactions, items: Record<id, QnaItem>,
highlightedId, onBoard}`. A `QnaItem` is the public question view plus what the role knows
(`mine`/`upvoted` for a participant, `participantId` for the host). Events carry only the public
view and merge into what is there.

- Module actions (`live/module`, prefix `qna`): `loaded` (the list response, both roles), `asked`,
  `voted` (the upvote response), `host-updated` (the PATCH/highlight response).
- Events: `qna:question|updated|votes|highlight`; events of another `sessionId` are ignored once the
  slice knows its own. `session:lobby` / `lobby:opened` reset the slice (it reloads). A question that
  leaves the public lists disappears for participants who did not ask it; the author keeps it
  (status `rejected` etc.), the list just does not draw it. Slide events (`slide:shown`,
  `question:started`, `leaderboard:shown`, `quiz:ended`, `session:ended`) track whether a Q&A slide
  is on screen (`onBoard`).
- `isQnaOpen(slice, status)` mirrors the server: Q&A on for the deck, or a Q&A slide on screen, and
  the session not ended. The server stays the authority (403 `QNA_DISABLED`).
- `sortQuestions(items, 'top' | 'new')`: pinned first, then votes (top) or time; ties newest first.

`useQnaSync()` (`useQnaSync.ts`) loads the list once the surface knows the deck (and, for a
participant, the identity), again after a reset, and after a socket reconnect; `loadQna(store)`
runs one request per store at a time. The participant's list needs the credentials as headers
(`X-Participant-Id`, `X-Participant-Token`, `api.ts`), never in URL or body.

**Participant-addressed events.** The live hook still listens on the legacy `quiz:event`, which
carries only the `all` and `host` audiences. Events for one participant (the author of a
rejected question) travel on `live:event` only, so `QnaParticipantSync` listens there for
`audience === participant:<own id>` and dispatches them. When the live hook moves to `live:event`
(W1-A2) this becomes redundant but harmless (the reducer upserts); remove it then.

## Participant UI

`QnaPanel`: ask form (label "Your question", 280-character counter, "Ask anonymously" only when the
deck allows it, a note when moderation is on), Top/New sort, the list with `QuestionCard`s.
The participant's own pending questions are listed first with "Waiting for approval" (others'
pending ones never reach the client). Upvote is a toggle button (`aria-pressed`, label "Upvote:
<text>"), disabled for one's own question and when upvotes are off. A closed Q&A shows why instead
of the form. The same panel is the phone view of a Q&A slide; builder previews get an inert
stand-in.

## Host UI

`HostQnaPanel`: status filters with counts (Pending, Visible, Answered, Archived, Rejected), sort
(most votes / newest), and per question the actions that fit its state (approve, reject, mark
answered, back to visible, pin, show on screen / hide, archive, restore). Every action calls the
host API and merges the response; failures show inline. Names are `"<action>: <question text>"`.

## The Q&A slide (`slides/types/qna/`)

Section `interactive` (picker "Interactive slides"), lifecycle `board`, never scored, no Settings
tab (`SettingsTab.appliesTo` skips it), not offered to the AI draft (`AI_SLIDE_TYPE_META`).
`question` is an optional heading; a draft save keeps it empty instead of "Untitled Question".
`QnaStage` draws `QnaBoard` (visible questions by votes, answered ones last and dimmed, at most 8,
"N more questions"; `thumbnail` mode draws placeholder rows). While the slide is on screen
participants can ask even if the deck's Q&A setting is off.

## Builder: Audience tab (`qna/builder/`)

Deck-level inspector tab (all slides). The deck id comes from `?id=` (the builder's edit URL); an
unsaved deck is asked to save first. Switches for `settings.qna` (`enabled`, `moderation`,
`anonymousAllowed`, `upvotes`) and `settings.reactions.enabled`, and up to 6 of 12 emoji
(`settings.reactions.emojis`). Each change PATCHes `/presentations/:id {settings}` on its own and
rolls back with an error on failure; settings apply to the next session (the server snapshots
them when the lobby opens). Strings are English literals, like the other builder tabs.

## Reactions

`ReactionsBar` holds a socket reference while it is on screen and emits
`reaction:send {presentationId, participantId, participantToken, emoji}` with an ack; taps closer
than 220 ms are dropped (the server allows 5/s per socket), the emoji pops locally at once, and a
`DISABLED` / `SESSION_ENDED` ack hides the bar. The allowed emoji come from the Q&A list response
(`reactions`). The stage (host surface) receives `reaction:burst {counts}` at most every 500 ms.

## i18n

`messages/en/qna.json` (namespace `qna`, added to `LiveIntlProvider`'s namespaces) holds every live
string, host panel included. The slot tab label "Q&A" is a literal (slot labels are plain strings).

## Tests

- Unit: `tests/unit/qna.state.test.ts` (reducer, selectors, open rules), `qna.api.test.ts` (client
  calls and headers, `loadQna`), `qna.components.test.tsx` (panels, board, overlay, reactions bar,
  registrations, slide editor, Audience tab), `reactions.state.test.ts` (burst slice, floaters,
  send gate); the slide registries' tests cover the `qna` type.
- E2E: `e2e/qna-reactions.spec.ts` (see [`../testing/e2e.md`](../testing/e2e.md)).
