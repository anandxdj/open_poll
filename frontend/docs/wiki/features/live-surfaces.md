---
summary: Live deck surfaces — host console, presenter view and audience window, phone remote, participant shell, stage, audience pace (participant run, host dashboard) — their session-aware flows, and their extension points: live store/reducer, slots, slide runtime registry, deck theme tokens, live i18n.
status: active
last_updated: 2026-11-05
---

# Live Surfaces

Routes: `/presentation/host/[id]` (host console), `/presentation/[id]/presenter` (presenter view,
W2-A), `/presentation/[id]/present` (audience window, W2-A), `/remote/[token]` (phone remote, W2-A),
`/live/[code]` (participant), `/live` (code entry). Code lives in `features/presentations/`, plus
`features/presenter/` and `features/remote/` for the W2-A surfaces ([Presenter view](#presenter-view-w2-a)). The realtime wire protocol is in
[`../data/realtime.md`](../data/realtime.md); the builder side in
[`presentation-builder.md`](./presentation-builder.md). The server contract these surfaces follow
is `backend/docs/wiki/modules/presentations-live.md`: every presentation is a **session**
(lobby → active → ended), a deck can be presented again and again, and a response slide has a
**phase** (`open` → `closed` → `revealed`, `reopen` goes back).

## Layout

| Piece | File | Role |
| --- | --- | --- |
| Host console | `components/host/HostConsole.tsx` | Own live store + `DeckThemeProvider`; header, Stage, controls, leaderboard modal, keyboard (←/→, PageUp/Down, F). A workspace template (`deck.isTemplate`, W3-B2) gets "This is a template" with Use template / Back to templates instead (`presenter.template.*`; the API refuses to present it, see `templates.md`). |
| Host session | `components/host/useHostSession.ts` | Reads host state on mount (never opens anything), follows the socket, resyncs, runs one host command at a time, timer-driven reveal. |
| Host commands | `components/host/hostCommands.ts` | `sendHostCommand`: one retry on `SESSION_BUSY`, flags `SESSION_ALREADY_LIVE`/`NO_LIVE_SESSION` as "console out of date". |
| Host chrome | `components/host/{HostHeader,HostControls,LeaderboardModal,useJoinLink}.tsx` | Top bar (+ `hostToolbar` slot, a link to the presenter view), bottom bar (back/forward, voting phase controls), standings overlay, join link copy. |
| Stage | `components/stage/Stage.tsx` | What the audience sees: ready, lobby, running slide, end. Controls come in as props (`readyActions`, `lobbyActions`, `endActions`, `overlays`) so a screen-only surface reuses it: the read-only screen stage of `features/embeds` (`surface="screen"`, no actions; `StageReady` then says it waits for the presenter and `StageEnd` shows no `endScreen` slot). |
| Stage parts | `components/stage/{StageReady,StageLobby,StageSlide,StageEnd,ResponseCounter,StageView,Leaderboard,Timer}.tsx` | `StageView` looks the slide type up in the runtime registry; `Leaderboard` and `Timer` are shared with the participant. |
| Participant shell | `components/participant/ParticipantShell.tsx` | Own live store; nickname gate, notices, slots, slide body. |
| Participant session | `components/participant/useParticipantSession.ts` | Code lookup → credentials of that session → `live-state`; socket, resyncs, lost credentials, "a new session is live". |
| Participant parts | `components/participant/{JoinGate,ParticipantSlide,ParticipantEnd,ParticipantNotices,participantSession}.ts(x)` | Nickname form; `response` slide state machine (timer, submitted, saved offline, refused, voting closed, time's up, result); end screen; not-found / kicked / ended / new-session notices; localStorage identity. |
| Answer delivery | `live/answerDelivery.ts` | `deliverAnswer`: socket `answer:submit` (3 s ack) → REST; `createSocketAnswerTransport`. |
| Offline queue | `live/offline/{types,storage,sync,index}.ts` | IndexedDB queue of answers keyed by `clientAnswerId` (memory fallback), the backoff sender `createAnswerSync`. |
| Sync notices | `components/participant/useAnswerSyncNotices.ts` | Toasts a queued answer refused for a slide no longer on screen. |
| Presenter view | `features/presenter/components/{PresenterConsole,PresenterControls,NotesPanel,NextSlidePreview,SessionClock,ResponseCounter,ParticipantList,RemotePairing,StartCountdown}.tsx` | W2-A: the host's second screen, see [Presenter view](#presenter-view-w2-a). |
| Audience window | `features/presenter/{components/AudienceWindow.tsx,audienceChannel.ts,useFullscreen.ts}` | The stage only, mirrored from the presenter view over a BroadcastChannel. |
| Presenter extras | `features/presenter/{soundCues.ts,remoteState.ts,module.ts,register.ts}` | Optional sound cues; the `remote` live slice (phone remote presence). |
| Phone remote | `features/remote/{RemoteConsole.tsx,useRemote.ts,api.ts}` | `/remote/<token>`: big buttons over its own socket. |
| Audience pace | `components/participant/audience/{AudienceRun,AudienceSlideCard,AudienceSummary,AudienceResults,audienceSlice,register}.ts(x)`, `components/host/{AudienceDashboard.tsx,useAudiencePaced.ts}` | W2-F: the participant's own run through an audience-paced deck, and the host's dashboard; see [Audience pace](#audience-pace-w2-f). |

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
- **Timer tools (W2-A).** `useHostSession` also runs `pauseTimer`, `resumeTimer`, `extendTimer(seconds)`
  and `skip` (time's up now) through the same one-command-at-a-time `run`, and `kick(participantId,
  name)` outside it (it is not a slide command). A paused window never triggers the timer-driven
  reveal (`countdown.paused`, no deadline).

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
   the tab to the foreground and every `seq` reset triggers another `live-state` read. Once
   joined, the offline answer queue runs (`startAnswerSync`, see [Answers](#answers-submitanswer)):
   answers saved while offline are sent on load, on reconnect and with backoff.
   A participant does **not** resync on a `seq` gap: `seq` counts host-only and other
   participants' events too, so gaps are normal (see `../data/realtime.md`).
5. After `slide:closed`, `question:revealed`, `leaderboard:shown` and `session:ended` the
   participant re-reads `/me` (score, rank, `lastAnswer`); a `lastAnswer` for the slide on screen
   marks it answered, which is how a revisit of an answered slide shows its result.

Credential failures are mapped by `participantLostReason` (store): `PARTICIPANT_KICKED` → `kicked`
(the credentials are forgotten and a "you were removed" screen replaces the shell; the
`participant:kicked` envelope in the phone's own room does the same at once, and so does a join
refused with `PARTICIPANT_KICKED`; the device record keeps `kickedSessionId`, so a reload of that
session goes straight back to the removed screen instead of the nickname form),
`PARTICIPANT_STALE` (answer from an ended session's participant) and any 404/401 → `stale` /
`missing`: the credentials are forgotten, the code is looked up again and the nickname form
(pre-filled, with a "that session is over" hint) rejoins the live session. `SESSION_FULL` on join
shows "This session is full".

An envelope of **another session** of the deck (the host presented again) is dropped by the
reducer; the shell looks the code up once per foreign session and, when the followed session is
over, shows a "A new session is live" notice with a **Join the new session** button.

Phase on the phone (`ParticipantSlide`): `open` — answer form, timer only when the window is
timed (a paused timer shows "Paused" with the frozen time and a "Timer paused" notice; the form keeps
the pick and Submit only toasts until the host resumes); `closed` and not answered — "Voting is closed"; answered — locked in / response received;
`revealed` — the result card from this slide's `lastAnswer`, or "Time's up!" (timed) / "Voting is
closed" (untimed) for a participant who did not answer. An answer in the offline queue shows
**"Saved — will sync"** (any phase before the reveal; it may still count within the slide ticket's
grace) until the server takes it (then locked in) or refuses it (then "Your answer arrived after
time ran out" / "Voting closed before your answer arrived" / "Your saved answer could not be
sent", "It was not counted."). A reopened slide shows the form again to those who had not
answered, and drops a refusal shown for it. Content and board slides (`slide:shown`) show the type's participant
view ("Look at the screen" for content slides).

## Live store (`live/store.ts`, `live/reducer.ts`)

One zustand store **per mounted surface** (`createLiveStore(role, init)` inside the shell, provided
with `LiveStoreProvider`), so client-side navigation never shows another session's state.

- `useLive(selector)` — subscribe to a slice (select primitives or stable references).
- `useLiveStore()` — the store API (`getState().dispatch(...)`, `subscribe`).
- `useLiveOptional(selector)` — for views that also render outside a session (previews,
  thumbnails); reads an empty participant store there.
- Store actions: `dispatch(action)`; `submitAnswer(payload)` → `accepted | duplicate | queued |
  skipped | error` — **the one function answers leave the client through**, for every slide type
  (socket `answer:submit` → REST → offline queue, below); `startAnswerSync()` (participant: runs
  the offline queue, returns its stop function), `flushAnswerQueue(force?)`,
  `setAnswerTransport(transport | null)` (the socket hook, after the `live:join` ack); `loadMe()`;
  `loadLiveState()` (participant: resync from `live-state`, credential failures land in `lost`);
  `resync(load)` (replaces state with a REST snapshot and replays the envelopes, host command
  responses and the participant's answer actions — `participant/submitted`, `answer-queued`,
  `answer-synced`, `answer-refused` — that arrived while it loaded, so a snapshot older than the
  latest event, or read before an answer landed, never wins; overlapping resyncs: the latest wins).

### Answers (`submitAnswer`)

Each call is one **attempt**: it gets a fresh `clientAnswerId` (`live/answerId.ts`, 32 hex chars,
`crypto.getRandomValues` so it also works on plain-http phones) and sends it with `sessionId`,
`slideId` and the slide's `slideTicket` (`LiveState.slideTicket`, from `question:started` and
`live-state.current.slideTicket`; null unless the window is open; a reopen brings a new one). The
server counts an answer once per `clientAnswerId`: a repeat returns the original with `replay: true`.
The same id goes along on **every** send of the attempt, over any channel, so it never counts twice.

One code path, for every slide type (`deliverAnswer` in `live/answerDelivery.ts`):

1. **Socket.** `answer:submit` (the REST body plus `presentationId`) on the joined socket, with a
   3 s ack timeout (`ANSWER_ACK_TIMEOUT_MS`). The socket is the store's *answer transport* only
   while it is joined as the participant: `useLiveSocket` registers it after the `live:join` ack and
   drops it on every disconnect, so after a reconnect nothing goes over the socket before the new
   join ack (the server would answer 403 `NOT_JOINED`), and a disconnected socket is never asked to
   buffer an answer (socket.io would flush it before the rejoin). A final ack ends the attempt; no
   ack in time, `NOT_JOINED`, 429 or 5xx go to REST.
2. **REST.** `POST /:id/answer` (10 s timeout, `ANSWER_REQUEST_TIMEOUT_MS`); a network error, 5xx
   and 429 are sent again (after 400 ms and 1.2 s; `createLiveStore(role, init,
   {answerRetryDelaysMs})` shortens it for tests); a request that ran into its timeout is not
   (a dead connection that still looks online would otherwise keep the phone waiting 30 s).
3. **Offline queue.** Still nothing definite: the answer is saved in IndexedDB
   (`live/offline/`, database `openpoll-live`, store `answers`, keyPath `clientAnswerId`, index on
   `presentationId`; a memory copy when IndexedDB throws, e.g. private modes) and `submitAnswer`
   resolves `queued` — the phone shows "Saved — will sync". When `navigator.onLine` is false
   nothing is sent at all and the answer is queued at once.

The queue's sender (`createAnswerSync`, started by `useParticipantSession` through
`startAnswerSync` once the participant has an identity) sends each queued answer again — same id,
`offline: true` (stored as `via: "offline"`), socket then REST — with backoff (1 s, 2 s, 4 s, 8 s,
15 s, then every 30 s, ±20%) and right away when the connection is back: the `online` event, the
tab becoming visible, the socket rejoining (the transport registering), and on page load. One pass
at a time; nothing is sent while the device reports itself offline; entries older than a day are
dropped unsent. Because the queue is in IndexedDB, a queued answer survives a reload or a closed
tab: the next page of that deck finds it, shows "Saved — will sync" again and sends it. Entries of
another session or identity (an old run) are sent too but never touch the screen.

Outcomes (live path → `SubmitAnswerResult`; queue → `pendingAnswers`):

| Server says | Live path | Queued answer |
| --- | --- | --- |
| accepted (also `replay: true`) | `accepted {replay, clientAnswerId}`, answered | removed, `participant/answer-synced` → answered (if the slide is still on screen) |
| 409 `ALREADY_ANSWERED` | `duplicate` (counts as answered) | same as accepted |
| 400 `NOT_ACCEPTING` / `TIME_UP` | `error {code}` + `live-state` re-read | `participant/answer-refused {code}` + `live-state` re-read |
| `PARTICIPANT_STALE` / `_KICKED` / 401 / 404 | `error`, sets `lost` | refused, sets `lost` |
| other 400 | `error {message}` | refused ("could not be sent") |
| no response, timeouts, 5xx, 429 | `queued` | stays queued, next backoff step |

`ParticipantSlide` maps live-path codes to localized toasts and shows queued / refused answers of
the slide on screen in place of the form; `useAnswerSyncNotices` toasts a refusal for a slide that
is no longer on screen ("Voting on slide 2 closed before your saved answer arrived, …").
Grading is never in the response: results stay hidden until the reveal. The ticket extends the
server's late-answer grace from 0.75 s to 15 s while the host has not closed or revealed the slide.
Scored timed slides are also auto-revealed by the server 1.5 s after their timer; the host console's
own timer-driven reveal still covers unscored slides and a reveal being repeated is harmless.

`LiveState` (see `reducer.ts`): `role`, `presentationId`, `connected` (socket joined), `sessionId`,
`runNumber`, `sessionStartedAt` (host: when the session opened, for the presenter's clock), `status` (`draft` = never presented, host only; `lobby`, `active`, `ended`), `title`,
`joinCode`, `totalSlides`, `currentSlideIndex`, `slideId`, `phase` (`shown | open | closed |
revealed`, null in the lobby and once ended), `isLastSlide`, `deck` (host only, answer keys
included), `slide` (participant, sanitized; a leaderboard slide is synthesized), `timing
{startedAt, endsAt, clockOffsetMs, pausedRemainingMs?, durationMs?}` (only while `open`; `endsAt`
null = untimed, or paused when `pausedRemainingMs` is set; `durationMs` = the timer's budget with
extensions), `clockOffsetMs`
(latest sample), `reveal`, `distribution` (host only), `answeredCount`, `participants`,
`leaderboard`, `results` (host: stored results of visited response slides, by slide id),
`slideTicket` (participant), `settings` (participant, from `live-state`), `self`, `me`, `submittedSlideIndex`,
`pendingAnswers` (participant: by `pendingAnswerKey(slideId, slideIndex)`, `{clientAnswerId, status:
"queued" | "refused", code, message}`; cleared with the session), `lost`, `lastSeq`, `modules`.

`liveReducer(state, action)` is pure. An envelope whose `sessionId` is not the followed session
only updates `lastSeq`. Actions:

| Action | From |
| --- | --- |
| `live/reset`, `live/connection` | shells, `useLiveSocket` |
| `live/event {event, receivedAt}` | `useLiveSocket` — every realtime envelope for this deck |
| `live/module {prefix, name, payload}` | a feature module's own actions |
| `host/state-loaded`, `host/command` | `useHostSession` (host state read; any command's response) |
| `participant/info-loaded`, `participant/joined`, `participant/live-state`, `participant/me-loaded`, `participant/submitted`, `participant/lost` | participant session, store actions |
| `participant/answer-queued`, `participant/answer-synced`, `participant/answer-refused` | the offline queue (store) |

Events handled (host and participant): `session:lobby`, `slide:shown`, `question:started`
(`reopened` keeps answers / the participant's "answered"), `slide:closed` (`revisit`),
`question:revealed` (`revisit`), `leaderboard:shown`, `session:ended`, `participant:joined`,
`answer:received` (host only, coalesced by the server to one per dirty slide per 250 ms with the
slide's counts and distribution; counts only grow on the slide on screen and fill the per-slide
`results`), `slide:timing` (W2-A: replaces the open window's timing — same slide and `startedAt`
only; a host command response with a newer deadline or frozen time wins over timing kept from
events), `participant:kicked` (host: drops the participant from the list and the standings;
participant: its own id → `lost: "kicked"`, identity forgotten). The legacy copies `lobby:opened` /
`quiz:ended` are ignored.
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
`useCountdown(timing, totalSeconds)` ticks from one shared 100 ms clock and returns `{timed, paused,
secondsLeft, progress, expired}`; untimed windows report `timed: false` and never expire; a paused
window (`pausedRemainingMs` set) reports `paused: true`, its frozen time and never expires; the value
is capped at the window's budget — `timing.durationMs` (time limit plus extensions) when known, else
the slide's own time limit. `Timer` takes `paused` and a `tone` (`audience` for the phone, `stage` for
the always-dark projected stage).

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
| `stageOverlays` | `{surface: 'host' \| 'screen', presentationId}` | Inside the stage `<main>` (absolutely positioned layers), every status. `screen` is the read-only stage of `features/embeds`. |
| `hostToolbar` | `{presentationId}` | Start of the host header's right-hand group. |
| `presenterPanels` | `{presentationId}` | Under the presenter view's side panels (W2-A; Q&A registers its panel here). |

Same `id` again replaces the entry. Slot components read anything else from `useLive` — e.g.
`useLive((s) => s.sessionId)` is the session the surface follows (host: the live or latest one;
participant: the one joined, kept after it ends and after a reload, so an `endScreen` entry can link
to that session's summary). `endScreen` renders on both end screens (`StageEnd`, `ParticipantEnd`). The props
interfaces are open for `declare module` augmentation. Builder inspector tabs are **not** a slot:
they have their own registry (`components/builder/inspectorTabs.ts`).

**Adding a module:** put its registrations in e.g. `features/qna/register.ts`
(`registerLiveReducer('qna', …)`, `registerSlot('participantTabs', …)`) and add one line to
`features/registrations.ts` (alphabetical).

## Presenter view (W2-A)

`/presentation/<id>/presenter` — `PresenterConsole`, its own host live store and `useHostSession`
(the same reads, socket and commands as the host console, which links to it; "Simple view" goes back).

- **Left:** the stage (`Stage surface="host"`, with the ready / lobby / end actions), then the
  controls (`PresenterControls`): Prev / Next (or End Session on the last slide); Close voting /
  Reveal / Reopen; on an open timed slide **Pause timer** or **Resume timer**, **+30 s** and **Skip
  timer** (time's up now). Optional "Countdown before the first slide" (a 3-2-1 over the stage and the
  audience window, then `start`).
- **Right:** session clock (elapsed since the session opened, on the server clock, and local time) and
  responses ("N of M", the timer state); **speaker notes** of the current slide (the first slide
  before the run; never in a participant payload, never on the audience window); the **next slide**
  (`SlideThumbnail`); **participants** with **Remove** (confirmed in the app's own `AlertDialog`,
  never `confirm()`); **phone remote** pairing; the `presenterPanels` slot.
- **Header:** live badge, participants, join code (copies the link), **Open audience window**
  (shows "Audience window open" once one answered), **Sound cues** on/off (muted by default,
  remembered in localStorage `openpoll_presenter_sound`), Simple view, fullscreen. Keys:
  ←/→/PageUp/PageDown while presenting, F fullscreen.

**Audience window** — `/presentation/<id>/present` (`AudienceWindow`), opened with
`window.open(path, "openpoll-audience-<id>", "popup,…")` (a blocked pop-up shows a hint). It has **no
socket**: the presenter view mirrors its live store over `BroadcastChannel("openpoll-presenter-<id>")`
(`audienceChannel.ts`): the audience says `hello` on load (again every 2 s until answered), the
presenter sends `state` (the store's data fields, no functions; at most every 50 ms on change and every
2 s as a heartbeat) with `ui {sound, countdown}`, and `bye` when it closes (the window keeps the last
slide and says the presenter view was closed). It renders `Stage surface="screen"` without controls,
the start countdown and the `stageOverlays` (Q&A highlight, reactions: they are store slices, so they
travel with the snapshot). Fullscreen with F or the corner button (`useFullscreen`: the Fullscreen API
needs a gesture in that window). Sound cues play in the audience window when one is open, else in the
presenter view (`soundCues.ts`: Web Audio chirp on a question opening, chime on the reveal, ticks in
the last three seconds).

**Phone remote pairing** (`RemotePairing`): **Pair a phone** → `POST /host/remote-token`, a QR code of
`<origin>/remote/<token>` (shown once; after a reload the panel shows the status and offers **New
pairing code**), **Copy link**, **Unpair**. Status (Not paired / Waiting for a phone to scan / Phone
connected / Paired phone offline) from `GET /host/remote-token` and the `remote` live slice
(`remote:connected` / `remote:disconnected`, `live/module remote/status`).

**Phone remote** — `/remote/<token>` (`RemoteConsole`, `useRemote`): a device key (48 hex characters,
localStorage `openpoll_remote_device`) binds the pairing on first use. The page joins with `remote:join`
on every (re)connect, re-reads `GET /api/remote/:token/state` (debounced) on slide events and every 3 s
in the lobby or while voting is open (answer counts are host-only events), and sends `remote:command`
with a 5 s ack: **Previous**, **Next** (starts slide 1 from the lobby), **Reveal**, **Close voting**,
**+30 s**, **Pause** / **Resume**. It shows the slide position and title, phase, timer, "N of M
answered", up next and the speaker notes. Final screens: the link no longer works (unpaired, replaced,
expired), the pairing belongs to another phone, the presenter unpaired it (`remote:revoked`).

## Audience pace (W2-F)

Server contract: `backend/docs/wiki/modules/presentations-live.md` → "Audience pace (W2-F)". A deck
with `pace: "audience"` opens every response slide at once and each participant moves through the
deck on their own; there is no current slide and no timer.

**Live slice** (`components/participant/audience/audienceSlice.ts`, registered by
`audience/register.ts` from `features/registrations.ts`; `state.modules.audience`, read with
`audienceSliceOf(state)`): `pace` and `nickname` (code lookup, `live-state`), `participant` (the run:
`live-state.audience`, or the view a submit / retry answered with — `live/module audience/view`),
`answered` (slides accepted since that view: `participant/submitted` with `slideId`,
`participant/answer-synced`), `host` (`host/state.audience`), `window` (`audience:opened` /
`audience:closed`, command responses).

**Answers.** `submitAnswer(payload, target?)` takes the slide to answer when it is not the current
one: `{slideId, slideIndex, slideTicket, attempt}`; the body carries them (and `attempt`), so the
socket → REST → offline queue path is the same, and a queued answer of an earlier attempt replays as
that attempt. An accepted targeted answer re-reads `live-state` (not `/me`). `ATTEMPT_SUBMITTED` /
`ATTEMPT_STALE` toast "That attempt is over" and re-read.

**Participant** (`components/participant/audience/`): `ParticipantShell` renders `AudienceRun` instead
of the slide body when the slice's pace is `audience` (lobby, active and ended). `AudienceRun`: the
waiting screen until the host opens; then the progress ("2 of 5 answered", bar), the closing time
("Closes in 12 min" / at a time / "Closed"), an "Attempt n" badge, a numbered slide strip (44 px
buttons, answered ones tinted, content slides dashed), the slide, Back / Next (Finish on the last
slide) and the summary page. `AudienceSlideCard`: content slides show themselves (`mode="audience"`);
a response slide shows the type's form while open and unanswered in the current attempt, "Saved —
will sync" / the refusal for a queued answer, then "Answer saved" (ungraded) or "Answer locked in"
(graded) with "Your answer: …", right or wrong with the points and the explanation once `final`, and
`AudienceResults` (bars for choices, top words and answers, scale averages, rankings; correct marks only
when the server sent them) when `resultsVisibility` allows; hints say when results come. `AudienceSummary`:
before submitting, the answered count, jump buttons to unanswered slides and **Submit answers** (the
offline queue is flushed first; queued answers block the submit with "Saving your answers…"); "See
my result" once closed; after submitting, the percentage and points, Passed / Not passed with the pass
mark, attempts left, earlier attempts, **Try again** (`canRetry`, opens slide 1 of the new attempt)
and **Review answers**. On `audience:opened`, `audience:closed` and `session:ended` (audience pace)
`useParticipantSession` re-reads `live-state`. `JoinGate` follows the nickname rule: `required` as
before, `optional` ("Nickname (optional)", empty joins as "Guest NNNN"), `off` (no field).

**Host** (`components/host/AudienceDashboard.tsx`, `useAudiencePaced()`): the host console and the
presenter view render the dashboard instead of the stage (and ignore the slide keys) for an
audience-paced session (the live session's pace, else the deck's). It shows the status (Not open yet,
Lobby open, Open, Closed, Ended), the settings line (assessment, results on phones), the closing time,
the join link, code and QR; **Open to participants** (with an optional "Close automatically at" date and
time; empty takes the deck's default duration), **Open lobby first**, **Save closing time** and **Close
now** while open (confirmed in the app's `AlertDialog`, never `confirm()`), **Open again** after a close,
**End session** (`EndSessionDialog`), **Run again** after the end; stats (participants, started, finished
"n of m", passed and not passed with an assessment); progress per question (participants whose current
attempt answered it) and who is in (progress n/m, attempt, In progress / Not started / Passed · 80% /
Not passed · 40% / Removed); the `endScreen` slot once ended. `useHostSession` adds `openAudience(closesAt?)`,
`closeAudience()` and `refresh`, and re-reads host state (at most once a second) on `answer:received`,
`participant:joined`, `participant:kicked` and `audience:*` for an audience-paced deck.

**Stage** (`components/stage/StageAudience.tsx`): while an audience-paced session runs, `Stage` (the
audience window and room screens; the host console and presenter view show the dashboard instead) shows
"Answer at your own pace", the join link, code and QR, the closing time, participants, finished and
progress per question from the slice's `host` view — never a name, an answer or a result ("Answers are
closed" once closed). Room screens get a counts-only `audience` view (`frontend/docs/wiki/features/embeds.md`).

**i18n:** `live.audience.*` (phone), `live.participant.nickname{Optional,Off}*` (join form),
`presenter.audiencePace.*` and `presenter.errors.{openAudience,closeAudience}` (dashboard).

**Fixed on the way:** the multi-select answer form was interactive only in `mode="live"`; like every
other form it is now inert only in `preview`, so converted multi-choice polls work at audience pace.

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

**wordcloud.** `slides/types/wordcloud/WordCloud.tsx` draws the words; the layout lives in
`cloudLayout.ts` (pure, tested in `tests/unit/wordcloud.layout.test.ts`). Each word's ink is measured on a
canvas in the cloud's own font (900 weight, `tracking-tight`); sizes grow with every repeat (log scale up to
8 answers, then relative to the top word).
- **Live** (`mode="live"`, the stage while voting and after reveal, and the landing sample): the previous
  cloud is the starting point of the next. A word keeps the spot it first landed on and grows there; bigger
  words keep their spot first (ties: the older word) and a smaller word in the way slides just far enough out
  of it. New words land on a spiral from the middle with room around them to grow into, and keep their
  orientation (about 40% of small new words run vertically). When a new word finds no room, or 40 words
  are shown (`LIVE_LIMIT`), the cloud starts over: the top 3 (`KEEP_ON_RESET`) stay where they are, the rest
  give way to what is arriving, and a word that dropped out comes back when someone sends it again.
  Updates with the same counts move nothing; a font that finishes loading re-measures the words in place;
  only a new box size lays the cloud out afresh.
- **Fit** (`mode="fit"`, session reports): every word at once, at the largest size (up to 1.6×) where all
  of them fit.
- Colours come from `cloud-1..12`, hashed from the word, so a word keeps its colour. `className` replaces
  the default box (the landing sample uses it).

**Advanced interactive types** (`guess_number`, `hundred_points`, `grid_2x2`, `pin_on_image`; all
`response`). The participant slide carries the type's sanitized settings (`config`, and `content` for
the pin image: never the correct number, tolerance or area), read with the defensive readers in
`slides/types/<type>/config.ts` (and `slides/advanced/read.ts`). Answers are posted as
`onSubmit({payload})`: `{value}`, `{points}`, `{positions}`, `{x, y}`. Results arrive as
`kind: "guess_number" | "hundred_points" | "grid_2x2" | "pin_on_image"` distributions that are not in
the `RevealDistribution` union: each stage parses them with `parse<Type>Distribution(live.distribution
?? reveal?.distribution)` (null for anything malformed) and draws the empty slide from the deck slide's
own config without data (`thumbnail`, before the first answer).

| Type | ParticipantView | StageView |
| --- | --- | --- |
| `guess_number` | slider + number field over min…max in steps (snapped, starts mid-range), big value readout | histogram (one bar per value for small ranges), guesses / mean / median; `reveal`/`report` light up the bars within correct ± tolerance and show "Correct answer" |
| `hundred_points` | per item: − / + (5 points), slider and number field; live "points left / too many", submit only at exactly 100 | average points per item as bars, authored order live, best first with ranks once revealed |
| `grid_2x2` | square board with named axes and corners; tap or drag the selected item (a tap near a placed item grabs it), or focus the board and move it with the arrow keys (Shift = 5 steps, Enter = next item); item list shows what is placed | the same board with each item numbered at its average position over a faint dot for every placement (the newest 200 participants), corner names, and a legend with the coordinates |
| `pin_on_image` | the image: tap / drag to drop and move one pin, or focus it and use the arrow keys (cursor) + Enter; submit sends `{x, y}` in [0,1] | the image with the newest pins live; once revealed a heatmap of all pins, the correct area (dashed) and "N of M in the correct area" |

Participant inputs are keyboard-accessible and ≥ 44 px; the board and image use `touch-action: none`
so a drag does not scroll. `preview` mode disables every control. The stages size themselves with
`vh` (like the other types) except in `thumbnail` mode, where the builder rail scales a 960×540 stage.

**Adding a slide type (runtime side):** add `participant.tsx` + `stage.tsx`, one line in
`RUNTIMES`, and its lifecycle. `tests/unit/slides.runtime.test.tsx` fails until every builder type
has a runtime.

## Deck theme (`theme/tokens.css`, `theme/DeckThemeProvider.tsx`)

- Every live surface colours itself through `--deck-*` variables via Tailwind colours
  `deck-*` (`bg-deck-stage-bg`, `text-deck-accent/40`, `border-deck-correct/50`…), registered with
  `@theme inline` in `tokens.css` (imported by `app/globals.css`). No raw palette colours in live
  UI; the phone's result states (correct / wrong / received) use the app's `success`, `destructive`
  and `info`, which a deck scope sets to its own mode.
- **Light or dark.** A deck is light or dark (`theme.mode`, light by default; backend
  `modules/themes.md`). `DeckThemeProvider` marks its scope `data-deck-mode="light|dark"` and
  `tokens.css` gives that scope the Graph paper look of the mode, for the stage **and** the phones:
  - light: the app's light tokens — paper stage `#f6f6f3` with white chrome and panels, ink
    `#171717`, the ember fill `#cf460c` with white text (`stage-ink`), text colours that keep 4.5:1
    on paper and white (`correct-soft` `#15803d`, `danger-soft` `#b91c1c`, `accent-soft` `#b93d0b`,
    gold / silver / bronze ranks), the cloud in the 700/800 chart steps, a paper `stage-scrim`;
  - dark: the warm graphite stage (`#141413`, `stage-fg` `#f2f1ec`), the brand ember `#f97316`, the
    400-step cloud colours, the app's dark tokens on phones.
  Each mode block also sets the app's own tokens (`--background`, `--primary`, `--muted-foreground`,
  `--success`…, `color-scheme`), so Button, Input and `text-muted-foreground` inside a deck follow the
  deck, not the viewer's app theme. The `dark:` variant (`app/globals.css`) applies in a dark deck
  scope and not in a light deck drawn on a dark page.
- Outside any deck scope `:root` keeps the look from before modes (a dark stage, audience tokens
  following the app): what the landing samples use.
- `.stage-grid` draws the graph paper in the stage's own ink behind the ready, lobby and end screens;
  a running slide has a plain stage. `qr-bg` / `qr-fg` keep QR codes dark on white in both modes.
- Stage chrome (host header and controls, lobby, ready, end, response counter, leaderboard) uses
  sentence case and 14px+ labels, neutral outline pills for secondary controls, the accent only on
  the main action (Start, Next) and the join code; ending the session is an ink (`stage-fg`)
  button, not red. `Timer` and the 2x2 `Board` have a `stage` and a phone tone; both follow the mode.
- `<DeckThemeProvider theme={{ mode, tokens: { primary: '#…' } }}>` sets the mode and overrides as
  inline variables on a `display: contents` element; inside it the shadcn tokens (`--primary`,
  `--background`, `--card`…) are remapped to the deck ones (after the mode blocks, so a custom
  theme's inline values win). `DECK_TOKENS` lists every token. Without a theme the scope has no mode.
- **Which theme a surface draws (`features/themes/LiveDeckTheme.tsx`).** The live store keeps the
  session's `theme` snapshot (host `SessionView`, participant `live-state`, code lookup) and, on the
  host and screen stores, `deckTheme` (host state: the deck's theme as it is now). A live session
  (lobby, active) draws its snapshot, so editing the deck never restyles it; otherwise (ready screen,
  ended) the deck's current theme, else the last snapshot; until either is known, the app's mode
  (`useAppThemeMode`). Host console, presenter view, audience window (mirrors the presenter's store),
  screen stage and participant shell use it; the phone remote wraps itself in the remote state's
  `theme`; session reports draw each result panel in the session's snapshot (dark for sessions from
  before themes).
- `deckThemeFrom(tokens)` (`features/themes/deckTheme.ts`): the mode (snapshots from before modes
  have none and stay dark); for the built-in look (`custom: false`) nothing more; for a custom theme
  the palette for the stage (`stage-*`, accent, correct, wrong, `cloud-1..12` from its chart colours)
  and the phones (`bg`, `fg`, `surface`, `muted-fg`, `secondary` / `border` / `input` mixed from the
  text, `primary`, `ring`). Every built-in palette passes the API's contrast checks in both modes.
  `DeckTheme` also carries fonts (the provider sets the body `font-family`, `--theme-font-heading` for
  `h1`–`h3`, and loads Google Fonts stylesheets with `<link precedence>`), a logo (`StageLobby`, the
  participant header) and a stage background picture (`Stage`, under the stage colour at the kit's
  overlay). `useDeckTheme()` reads them.
- `tests/unit/theme.tokens.test.ts` fails on a `deck-*` utility or `var(--deck-*)` that names no
  token, when `DECK_TOKENS` and `tokens.css` drift, when a mode block misses a token or an app
  token, and when the light or dark block loses contrast (text 4.5:1 on the stage and panels, marks
  3:1, cloud words, text on the accent). `tests/unit/themes.test.tsx` covers `deckThemeFrom`, the
  provider's `data-deck-mode` and the library card mapping.

## i18n (live routes only)

- `next-intl`, client-side only: `app/live/layout.tsx`, `app/presentation/host/layout.tsx`,
  `app/presentation/[id]/layout.tsx` (presenter view, audience window) and `app/remote/[token]/layout.tsx`
  wrap pages in `i18n/LiveIntlProvider.tsx` (no request config, no `next.config` plugin).
- Messages: `messages/<locale>/<feature>.json`, one file per feature; `i18n/messages.ts` is the
  append-only namespace list and types every key (`i18n/global.d.ts`). Locales: `i18n/config.ts`
  (`en` only for now).
- `live.json` holds the participant-facing strings (join page, participant shell and its notices —
  voting closed, reconnecting, session full, removed, ended, new session —, slide answer forms,
  leaderboard, timer, content slides: `slides.content.lookAtScreen*`,
  `slides.{image,video,instructions}.*`). `presenter.json` holds the host console and stage
  (`presenter.header|ready|lobby|slide|controls|end|toasts|errors|load|connection`) and the W2-A
  presenter view (`presenter.console|kickDialog|remote|audience`). `remote.json` (namespace `remote`)
  holds the phone remote page.
  `slides-advanced.json` (namespace `slidesAdvanced`) holds the strings of the advanced slide views
  (`slidesAdvanced.guessNumber|hundredPoints|grid2x2|pinOnImage`). `LiveIntlProvider` ships `live`,
  `presenter`, `qna`, `remote` and `slidesAdvanced`: a package that adds a namespace used on live
  surfaces appends it there.

## Tests

- Unit (`bun run test`): `tests/unit/live.reducer.test.ts` (every event and snapshot, session
  scoping, seq planning, module sub-reducers), `live.clock.test.ts` (countdown offset incl. the
  lobby-wait bug), `live.store-and-slots.test.tsx` (store, `submitAnswer` payload, error codes,
  `live-state`, resync replay, slots), `live.offline-queue.test.ts` (backoff, storage and its memory fallback, the socket transport,
  `deliverAnswer` socket → REST, the queue sender, pending answers in the reducer, `submitAnswer`
  offline → queued → synced / refused, reload restore, resync replay), `live.participant-session.test.ts` (credential keying),
  `live.host-commands.test.ts` (`SESSION_BUSY` retry, stale console), `live.surfaces.test.tsx`
  (host controls / stage / participant slide per phase, saved offline and refused), `slides.runtime.test.tsx`,
  `slides.content.test.tsx`, `slides.advanced.test.tsx` (the four advanced types: settings readers
  and validation mirroring the backend, editors, board / pin / points helpers, views),
  `media.test.tsx`, `theme.tokens.test.ts`, `presenter.test.tsx` (W2-A: `slide:timing` and
  `participant:kicked` in the reducer, paused countdowns, `SLIDE_PAUSED` retried, the remote presence
  slice, the audience snapshot, presenter view and paused phone markup), `audience.test.tsx` (W2-F: the
  audience slice, targeted answers with ticket and attempt, the Pace tab helpers, the multi-select form in
  audience mode, the phone run / result and the dashboard markup). Shared fixtures:
  `tests/unit/live.fixtures.ts`.
- E2E (`bun run test:e2e`): `e2e/live-flow.spec.ts`, `e2e/live-session.spec.ts`, `e2e/offline-answers.spec.ts`,
  `e2e/presenter.spec.ts`, `e2e/audience-pace.spec.ts`, `e2e/deck-themes.spec.ts`,
  `e2e/content-slides.spec.ts`, `e2e/select-answer.spec.ts`, `e2e/advanced-slides.spec.ts` — see
  [`../testing/e2e.md`](../testing/e2e.md).
