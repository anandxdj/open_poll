---
summary: Live deck surfaces — host console, participant shell, stage — their session-aware flows, and their extension points: live store/reducer, slots, slide runtime registry, deck theme tokens, live i18n.
status: active
last_updated: 2026-10-19
---

# Live Surfaces

Routes: `/presentation/host/[id]` (host console), `/live/[code]` (participant), `/live` (code
entry). Code lives in `features/presentations/`. The realtime wire protocol is in
[`../data/realtime.md`](../data/realtime.md); the builder side in
[`presentation-builder.md`](./presentation-builder.md). The server contract these surfaces follow
is `backend/docs/wiki/modules/presentations-live.md`: every presentation is a **session**
(lobby → active → ended), a deck can be presented again and again, and a response slide has a
**phase** (`open` → `closed` → `revealed`, `reopen` goes back).

## Layout

| Piece | File | Role |
| --- | --- | --- |
| Host console | `components/host/HostConsole.tsx` | Own live store + `DeckThemeProvider`; header, Stage, controls, leaderboard modal, keyboard (←/→, PageUp/Down, F). |
| Host session | `components/host/useHostSession.ts` | Reads host state on mount (never opens anything), follows the socket, resyncs, runs one host command at a time, timer-driven reveal. |
| Host commands | `components/host/hostCommands.ts` | `sendHostCommand`: one retry on `SESSION_BUSY`, flags `SESSION_ALREADY_LIVE`/`NO_LIVE_SESSION` as "console out of date". |
| Host chrome | `components/host/{HostHeader,HostControls,LeaderboardModal,useJoinLink}.tsx` | Top bar (+ `hostToolbar` slot), bottom bar (back/forward, voting phase controls), standings overlay, join link copy. |
| Stage | `components/stage/Stage.tsx` | What the audience sees: ready, lobby, running slide, end. Controls come in as props (`readyActions`, `lobbyActions`, `endActions`, `overlays`) so a screen-only surface can reuse it. |
| Stage parts | `components/stage/{StageReady,StageLobby,StageSlide,StageEnd,ResponseCounter,StageView,Leaderboard,Timer}.tsx` | `StageView` looks the slide type up in the runtime registry; `Leaderboard` and `Timer` are shared with the participant. |
| Participant shell | `components/participant/ParticipantShell.tsx` | Own live store; nickname gate, notices, slots, slide body. |
| Participant session | `components/participant/useParticipantSession.ts` | Code lookup → credentials of that session → `live-state`; socket, resyncs, lost credentials, "a new session is live". |
| Participant parts | `components/participant/{JoinGate,ParticipantSlide,ParticipantEnd,ParticipantNotices,participantSession}.ts(x)` | Nickname form; `response` slide state machine (timer, submitted, voting closed, time's up, result); end screen; not-found / kicked / ended / new-session notices; localStorage identity. |

Both surfaces import `features/registrations.ts` first, so every module registration has run
before their first render.

## Host flow

`useHostSession` reads `GET /:id/host/state` on mount and shows what the server reports. It never
calls `open-lobby` or `start` by itself (no `?reset=true`, no auto-open); every transition is a
host click or key.

| Server state (`status` in the store) | Stage | Host actions |
| --- | --- | --- |
| no session yet (`draft`) | "Ready to present" (no join code: nobody can join yet) | **Start presenting** (`start`, works with no lobby and no participants), **Open lobby** (`open-lobby`) |
| `lobby` | join code, QR, who joined | **Start** (`start`, no participants needed), **Close lobby** (`end`) |
| `active` | the current slide in its phase | footer: Prev / Next (`goto`), Close voting / Reveal / Reopen, End Session (`end`) |
| `ended` | final standings | **Present again** (`start`: a new session from slide 1), **Open lobby**, back to dashboard |

A live session resumes where it is after a reload: slide, phase, timer (`endsAt` + a fresh clock
offset), answered count, the distribution of the slide on screen, and the stored results of every
visited response slide (`results`, by slide id) so revisits show them.

- **Navigation.** Next / Prev and ArrowRight/ArrowLeft/PageDown/PageUp call `POST /host/goto
  {slideIndex}` (both directions). A revisit arrives as `slide:shown`, `slide:closed` (`revisit`) or
  `question:revealed` (`revisit`) and the stage shows the stored phase and results. Leaving an
  open slide closes it, and coming back does not reopen it.
- **Phases (response slides only).** `open`: **Close voting** (`close`; the only way to end an
  untimed slide — `timeLimit: 0`, `endsAt: null`, shown as "No time limit"; also available while
  timed) and **Reveal** (`reveal`, closes first). `closed`: **Reveal**, **Reopen**. `revealed`:
  **Reopen** (fresh timer, earlier answers stay and those participants cannot answer again).
- **Timer-driven reveal.** When a *timed* window runs out the host reveals it, once per window
  (keyed by session, slide and `startedAt`/`endsAt`, so a reopen is a new window) and not while
  another command is in flight. An untimed slide never auto-reveals.
- **One command at a time.** A held key or double click cannot stack navigations (`busy` guard).
  `SESSION_BUSY` is retried once; `SESSION_ALREADY_LIVE` and `NO_LIVE_SESSION` toast and re-read
  host state (the console was out of date); other errors toast the API message.
- **Resync.** Host state is re-read after every socket (re)join, on a `seq` gap (rate limited to
  one read per second), when the tab becomes visible, and when an envelope of a session the
  console does not follow arrives (another window started one). While in the lobby with the
  socket down it polls every 3 s.
- Keyboard: ArrowLeft/ArrowRight/PageUp/PageDown only while `active`; ignored with a modifier or
  inside inputs.

## Participant flow

`useParticipantSession(code)`:

1. `GET /code/:code` → `sessionId` of the live session (null once ended). A 404 (also a deck never
   presented) is the "not found" screen.
2. Credentials are looked up for **that session**: `openpoll_participant_{code}_{sessionId}` →
   `{participantId, name, token}`. When the deck has ended (`sessionId` null) the session last
   joined (`lastSessionId` in the device record) is used, so a reload still shows the final
   standings. The per-device record `openpoll_participant_{code}` keeps the signed `deviceToken`
   (same seat on a rejoin), the last nickname (pre-filled) and `lastSessionId`.
   (`components/participant/participantSession.ts`; every access is try/catch'd.)
3. With credentials: `GET /:id/live-state` (renders the current slide with phase, timer, results,
   own standing and whether the slide was answered). Without: the nickname form
   (`JoinGate`) when the session is `lobby`/`active`, else "This session has ended".
4. The socket joins (`live:join` with participant credentials); every (re)join, every return of
   the tab to the foreground and every `seq` reset triggers another `live-state` read.
   A participant does **not** resync on a `seq` gap: `seq` counts host-only and other
   participants' events too, so gaps are normal (see `../data/realtime.md`).
5. After `slide:closed`, `question:revealed`, `leaderboard:shown` and `session:ended` the
   participant re-reads `/me` (score, rank, `lastAnswer`); a `lastAnswer` for the slide on screen
   marks it answered, which is how a revisit of an answered slide shows its result.

Credential failures are mapped by `participantLostReason` (store): `PARTICIPANT_KICKED` → `kicked`
(the credentials are forgotten and a "you were removed" screen replaces the shell),
`PARTICIPANT_STALE` (answer from an ended session's participant) and any 404/401 → `stale` /
`missing`: the credentials are forgotten, the code is looked up again and the nickname form
(pre-filled, with a "that session is over" hint) rejoins the live session. `SESSION_FULL` on join
shows "This session is full".

An envelope of **another session** of the deck (the host presented again) is dropped by the
reducer; the shell looks the code up once per foreign session and, when the followed session is
over, shows a "A new session is live" notice with a **Join the new session** button.

Phase on the phone (`ParticipantSlide`): `open` — answer form, timer only when the window is
timed; `closed` and not answered — "Voting is closed"; answered — locked in / response received;
`revealed` — the result card from this slide's `lastAnswer`, or "Time's up!" (timed) / "Voting is
closed" (untimed) for a participant who did not answer. A reopened slide shows the form again to
those who had not answered. Content and board slides (`slide:shown`) show the type's participant
view ("Look at the screen" for content slides).

## Live store (`live/store.ts`, `live/reducer.ts`)

One zustand store **per mounted surface** (`createLiveStore(role, init)` inside the shell, provided
with `LiveStoreProvider`), so client-side navigation never shows another session's state.

- `useLive(selector)` — subscribe to a slice (select primitives or stable references).
- `useLiveStore()` — the store API (`getState().dispatch(...)`, `subscribe`).
- `useLiveOptional(selector)` — for views that also render outside a session (previews,
  thumbnails); reads an empty participant store there.
- Store actions: `dispatch(action)`; `submitAnswer(payload)` → `accepted | duplicate | skipped |
  error` — **the one function answers leave the client through** (REST today; the socket
  `answer:submit` ack and the offline queue of W2-D phase 2 plug in here); `loadMe()`;
  `loadLiveState()` (participant: resync from `live-state`, credential failures land in `lost`);
  `resync(load)` (replaces state with a REST snapshot and replays the envelopes that arrived while it
  loaded, so a snapshot older than the latest event never wins; overlapping resyncs: the latest wins).

### Answers (`submitAnswer`)

Each call is one **attempt**: it gets a fresh `clientAnswerId` (`live/answerId.ts`, 32 hex chars,
`crypto.getRandomValues` so it also works on plain-http phones) and sends it with `sessionId`,
`slideId` and the slide's `slideTicket` (`LiveState.slideTicket`, from `question:started` and
`live-state.current.slideTicket`; null unless the window is open; a reopen brings a new one). The
server counts an answer once per `clientAnswerId`: a repeat returns the original with `replay: true`.
So transient failures — no response, 5xx, 429 — are sent again with the **same id** (twice, after
400 ms and 1.2 s; `createLiveStore(role, init, {answerRetryDelaysMs})` shortens it for tests).
Outcomes: `accepted {replay, clientAnswerId}`; `duplicate` (409 `ALREADY_ANSWERED`: counts as
answered); `error {code, message}` with `NOT_ACCEPTING` / `TIME_UP` (window closed or over — the
store also re-reads `live-state`, so the phone catches up), `RATE_LIMITED`, `PARTICIPANT_STALE` /
`PARTICIPANT_KICKED` (these also set `lost`). `ParticipantSlide` maps the codes to localized toasts.
Grading is never in the response: results stay hidden until the reveal. The ticket extends the
server's late-answer grace from 0.75 s to 15 s while the host has not closed or revealed the slide.
Scored timed slides are also auto-revealed by the server 1.5 s after their timer; the host console's
own timer-driven reveal still covers unscored slides and a reveal being repeated is harmless.

`LiveState` (see `reducer.ts`): `role`, `presentationId`, `connected` (socket joined), `sessionId`,
`runNumber`, `status` (`draft` = never presented, host only; `lobby`, `active`, `ended`), `title`,
`joinCode`, `totalSlides`, `currentSlideIndex`, `slideId`, `phase` (`shown | open | closed |
revealed`, null in the lobby and once ended), `isLastSlide`, `deck` (host only, answer keys
included), `slide` (participant, sanitized; a leaderboard slide is synthesized), `timing
{startedAt, endsAt, clockOffsetMs}` (only while `open`; `endsAt` null = untimed), `clockOffsetMs`
(latest sample), `reveal`, `distribution` (host only), `answeredCount`, `participants`,
`leaderboard`, `results` (host: stored results of visited response slides, by slide id),
`slideTicket` (participant), `settings` (participant, from `live-state`), `self`, `me`, `submittedSlideIndex`, `lost`,
`lastSeq`, `modules`.

`liveReducer(state, action)` is pure. An envelope whose `sessionId` is not the followed session
only updates `lastSeq`. Actions:

| Action | From |
| --- | --- |
| `live/reset`, `live/connection` | shells, `useLiveSocket` |
| `live/event {event, receivedAt}` | `useLiveSocket` — every realtime envelope for this deck |
| `live/module {prefix, name, payload}` | a feature module's own actions |
| `host/state-loaded`, `host/command` | `useHostSession` (host state read; any command's response) |
| `participant/info-loaded`, `participant/joined`, `participant/live-state`, `participant/me-loaded`, `participant/submitted`, `participant/lost` | participant session, store actions |

Events handled (host and participant): `session:lobby`, `slide:shown`, `question:started`
(`reopened` keeps answers / the participant's "answered"), `slide:closed` (`revisit`),
`question:revealed` (`revisit`), `leaderboard:shown`, `session:ended`, `participant:joined`,
`answer:received` (host only, coalesced by the server to one per dirty slide per 250 ms with the
slide's counts and distribution; counts only grow on the slide on screen and fill the per-slide
`results`). The legacy copies `lobby:opened` / `quiz:ended` are ignored.
`planEnvelope(state, event)` decides per envelope: `foreign`, `duplicate`, or `apply` with an
optional resync (`gap` for the host only, `reset` for everyone).

Side effects stay out of the reducer: hooks re-read state (resync), call `loadMe`, persist
credentials, show toasts.

### Module sub-reducers

```ts
registerLiveReducer<S>(prefix, (state: S, action: LiveAction, root: LiveState) => S, initialState): () => void
```

- `prefix` (`/^[a-z][a-z0-9-]*$/`, not `live`/`host`/`participant`) names the slice
  (`state.modules[prefix]`) and the module's realtime types (`<prefix>:*`, e.g. `qna:question`).
- The sub-reducer sees **every** action after the core reducer ran (`root` is the new core
  state); `isModuleEvent(action, prefix)` picks out its own events. Return the same reference when
  nothing changed — the root state then keeps its identity too.
- `live/reset` restores every slice to its initial state. Re-registering a prefix replaces it.

## Server clock and countdowns (`live/clock.ts`, `live/useCountdown.ts`)

Deadlines (`endsAt`) are server times. The offset `serverNow − clientNow` is **measured from the
`serverNow` of every event and REST response at the moment it arrives** (`receivedAt`) and stored
with the window it belongs to (`timing.clockOffsetMs`; falls back to the latest sample when a
message has no `serverNow`). The old code kept the `serverNow` of the page load and paired it with
"now" at each question, so a participant who waited in the lobby saw a countdown that ran long by
the wait (plan §0 item 12; reproduced in `tests/unit/live.clock.test.ts`).
`useCountdown(timing, totalSeconds)` ticks from one shared 100 ms clock and returns `{timed,
secondsLeft, progress, expired}`; untimed windows report `timed: false` and never expire; the value
is capped at the slide's own time budget.

## Slots (`live/slots.ts`)

```ts
registerSlot(slot, { id, order?, label?, icon?, when?(props), Component }): () => void
<SlotOutlet name={slot} props={...} />   // renders matching entries in order, no wrapper
getSlotEntries(slot, props?)
```

| Slot | Props | Where / semantics |
| --- | --- | --- |
| `participantTabs` | `{presentationId, participantId}` | Extra tabs beside the built-in "Slide" tab; the tab bar only appears once one is registered. Uses `label`. |
| `participantBanner` | same | Above the participant main area. |
| `participantBody` | same | Replaces the slide tab's body; the first entry whose `when` matches wins. |
| `participantFooter` | same | Under the participant main area. |
| `endScreen` | `{role, presentationId}` | After the standings on the host and participant end screens. |
| `stageOverlays` | `{surface: 'host' \| 'screen', presentationId}` | Inside the stage `<main>` (absolutely positioned layers), every status. |
| `hostToolbar` | `{presentationId}` | Start of the host header's right-hand group. |
| `presenterPanels` | `{presentationId}` | Reserved for the presenter console (W2-A). |

Same `id` again replaces the entry. Slot components read anything else from `useLive` — e.g.
`useLive((s) => s.sessionId)` is the session the surface follows (host: the live or latest one;
participant: the one joined, kept after it ends and after a reload, so an `endScreen` entry can link
to that session's summary). `endScreen` renders on both end screens (`StageEnd`, `ParticipantEnd`). The props
interfaces are open for `declare module` augmentation. Builder inspector tabs are **not** a slot:
they have their own registry (`components/builder/inspectorTabs.ts`).

**Adding a module:** put its registrations in e.g. `features/qna/register.ts`
(`registerLiveReducer('qna', …)`, `registerSlot('participantTabs', …)`) and add one line to
`features/registrations.ts` (alphabetical).

## Slide runtime registry (`slides/runtime.ts`)

```ts
interface SlideRuntime {
  lifecycle: 'response' | 'system' | 'content' | 'board';
  ParticipantView: ComponentType<{ slide: LiveSlide; mode: 'live' | 'audience' | 'preview'; onSubmit(payload: AnswerPayload); submitting }>;
  StageView: ComponentType<{ slide: PresentationSlide; live: {distribution, answeredCount, leaderboard};
                             reveal; participants; mode: 'live' | 'reveal' | 'report' | 'thumbnail' }>;
}
getSlideRuntime(type) // undefined for unknown types
```

- Per type: `slides/types/<type>/participant.tsx` and `stage.tsx` (beside the builder's
  `meta.ts`/`editor.tsx`). `RUNTIMES` lists one line per type, alphabetical.
- `response`: the participant shell owns the timer, question header and the submitted / time's
  up / result states; `ParticipantView` is only the answer form (own state, remounted per
  question) and calls `onSubmit(payload)`. The stage draws counter, question, timer, then
  `StageView`. Anything else (`system` = leaderboard) renders its whole view.
- Participant modes: `live` = presenter pace (interactive), `audience` = audience pace (interactive;
  the phone is the only screen), `preview` = inert (inputs disabled). `StageView` draws revealed
  results in `reveal`/`report`, and the empty look of the slide in `thumbnail` (no data needed).
- `content` (heading, paragraph, bullets, image, big_number, quote, video, instructions): the type
  renders its whole view. ParticipantView shows a localized "Look at the screen" card in `live`
  and the slide itself in `audience`/`preview` (shared pieces in `slides/content/ContentViews.tsx`;
  payloads read with `slides/content/payloads.ts`, so `LiveSlide` needs no new fields — the server
  sends `{content: {…}}`). StageView is a fullscreen-quality layout inside a size container
  (`@container`, type in `cqw`) using only `--deck-*` tokens: big heading, markdown-lite paragraph
  (`slides/content/markdown.tsx`: bold/italic/links only, HTML shown as text), bullets that slide in
  one by one, image in its fit mode with caption, a big number that counts up, quote, 16:9 video
  (`features/media/VideoEmbed`; a still stand-in in thumbnails), and "go to <site>/live and enter
  the code" + QR with the session's join code (`useLiveOptional(s => s.joinCode)`).
- The shell renders a non-`response` slide's ParticipantView; the reducer sets `slide` from
  `slide:shown`, so participants see "Look at the screen" as soon as the host shows a content
  slide (also on a late join or a reload, through `live-state`).
- `components/stage/StageView.tsx` is the convenience wrapper: `<StageView slide mode="thumbnail" />`
  defaults the data props. The builder's `SlideThumbnail` renders it on a 960×540 stage scaled
  to the rail.
- Views use `next-intl` and the deck tokens: render them inside `LiveIntlProvider` (the live
  routes and `SlideThumbnail` do).

**select_answer.** A multi-select slide arrives with `slide.allowMultiple: true`: the
ParticipantView renders checkboxes and submits `{payload: {optionIndices}}` (`AnswerPayload.payload`
is the server's generic answer field; `submitAnswer` posts it as is). The stage reads the deck
slide's `config` (`selectAnswerConfig`): multi-select shares are of respondents (`answeredCount`),
the explanation shows in `reveal`/`report`, and only graded slides (`points > 0`) mark correct
options — an ungraded one shows plain results. `isGradedSlide(slide)` (`slides/shared.ts`) is the
participant shell's rule: a 0-point select answer gets "response received", never right/wrong.

**Adding a slide type (runtime side):** add `participant.tsx` + `stage.tsx`, one line in
`RUNTIMES`, and its lifecycle. `tests/unit/slides.runtime.test.tsx` fails until every builder type
has a runtime.

## Deck theme (`theme/tokens.css`, `theme/DeckThemeProvider.tsx`)

- Every live surface colours itself through `--deck-*` variables via Tailwind colours
  `deck-*` (`bg-deck-stage-bg`, `text-deck-accent/40`, `border-deck-correct/50`…), registered with
  `@theme inline` in `tokens.css` (imported by `app/globals.css`). No raw palette or app-theme
  colours in live UI.
- Defaults reproduce the built-in look: audience surfaces (`bg`, `fg`, `surface`, `secondary`,
  `muted-fg`, `border`, `input`, `ring`, `primary`, `primary-fg`) follow the app's light/dark
  tokens; the stage (`stage-bg` #050505, `stage-chrome`, `stage-panel`, `stage-fg`…) is always
  dark; accents (`accent`, `correct*`, `danger*`, `wrong`, `info`, `bar`, `rank-1..3`,
  `cloud-1..12`, glows) are the Tailwind palette values used before.
- `<DeckThemeProvider theme={{ tokens: { primary: '#…' } }}>` sets overrides as inline variables
  on a `display: contents` element; inside it the shadcn tokens (`--primary`, `--background`…)
  are remapped to the deck ones so `Button`/`Input` follow. `DECK_TOKENS` lists every token.
- `tests/unit/theme.tokens.test.ts` fails on a `deck-*` utility or `var(--deck-*)` that names no
  token, and when `DECK_TOKENS` and `tokens.css` drift.

## i18n (live routes only)

- `next-intl`, client-side only: `app/live/layout.tsx` and `app/presentation/host/layout.tsx` wrap
  pages in `i18n/LiveIntlProvider.tsx` (no request config, no `next.config` plugin).
- Messages: `messages/<locale>/<feature>.json`, one file per feature; `i18n/messages.ts` is the
  append-only namespace list and types every key (`i18n/global.d.ts`). Locales: `i18n/config.ts`
  (`en` only for now).
- `live.json` holds the participant-facing strings (join page, participant shell and its notices —
  voting closed, reconnecting, session full, removed, ended, new session —, slide answer forms,
  leaderboard, timer, content slides: `slides.content.lookAtScreen*`,
  `slides.{image,video,instructions}.*`). `presenter.json` holds the host console and stage
  (`presenter.header|ready|lobby|slide|controls|end|toasts|errors|load|connection`);
  `LiveIntlProvider` ships both namespaces.

## Tests

- Unit (`bun run test`): `tests/unit/live.reducer.test.ts` (every event and snapshot, session
  scoping, seq planning, module sub-reducers), `live.clock.test.ts` (countdown offset incl. the
  lobby-wait bug), `live.store-and-slots.test.tsx` (store, `submitAnswer` payload, error codes,
  `live-state`, resync replay, slots), `live.participant-session.test.ts` (credential keying),
  `live.host-commands.test.ts` (`SESSION_BUSY` retry, stale console), `live.surfaces.test.tsx`
  (host controls / stage / participant slide per phase), `slides.runtime.test.tsx`,
  `slides.content.test.tsx`, `media.test.tsx`, `theme.tokens.test.ts`. Shared fixtures:
  `tests/unit/live.fixtures.ts`.
- E2E (`bun run test:e2e`): `e2e/live-flow.spec.ts`, `e2e/live-session.spec.ts`,
  `e2e/content-slides.spec.ts`, `e2e/select-answer.spec.ts` — see
  [`../testing/e2e.md`](../testing/e2e.md).
