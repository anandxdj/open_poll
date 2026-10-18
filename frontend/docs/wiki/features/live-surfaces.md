---
summary: Live deck surfaces — host console, participant shell, stage — and their extension points: live store/reducer, slots, slide runtime registry, deck theme tokens, live i18n.
status: active
last_updated: 2026-10-19
---

# Live Surfaces

Routes: `/presentation/host/[id]` (host console), `/live/[code]` (participant), `/live` (code
entry). Code lives in `features/presentations/`. The realtime wire protocol is in
[`../data/realtime.md`](../data/realtime.md); the builder side in
[`presentation-builder.md`](./presentation-builder.md).

## Layout

| Piece | File | Role |
| --- | --- | --- |
| Host console | `components/host/HostConsole.tsx` | Own live store + `DeckThemeProvider`; header, Stage, controls, leaderboard modal, keyboard (←/→, PageUp/Down, F). |
| Host session | `components/host/useHostSession.ts` | Loads host state, follows the socket, countdown + timer-driven reveal, open lobby / advance / end. |
| Host chrome | `components/host/{HostHeader,HostControls,LeaderboardModal,useJoinLink}.tsx` | Top bar (+ `hostToolbar` slot), bottom bar, standings overlay, join link copy. |
| Stage | `components/stage/Stage.tsx` | What the audience sees: lobby, running slide, end. Controls come in as props (`lobbyActions`, `endActions`, `overlays`) so a screen-only surface can reuse it. |
| Stage parts | `components/stage/{StageLobby,StageSlide,StageEnd,ResponseCounter,StageView,Leaderboard,Timer}.tsx` | `StageView` looks the slide type up in the runtime registry; `Leaderboard` and `Timer` are shared with the participant. |
| Participant shell | `components/participant/ParticipantShell.tsx` | Own live store; load by code, nickname gate, socket, slots, slide body. |
| Participant parts | `components/participant/{JoinGate,ParticipantSlide,ParticipantEnd,participantSession}.ts(x)` | Nickname form; `response` slide state machine (timer, submitted, time's up, result); end screen; localStorage identity. |

Both surfaces import `features/registrations.ts` first, so every module registration has run
before their first render.

## Live store (`live/store.ts`, `live/reducer.ts`)

One zustand store **per mounted surface** (`createLiveStore(role, init)` inside the shell, provided
with `LiveStoreProvider`), so client-side navigation never shows another session's state.

- `useLive(selector)` — subscribe to a slice (select primitives or stable references).
- `useLiveStore()` — the store API (`getState().dispatch(...)`, `subscribe`).
- `useLiveOptional(selector)` — for views that also render outside a session (previews,
  thumbnails); reads an empty participant store there.
- Store actions: `dispatch(action)`, `submitAnswer(payload)` → `accepted | duplicate | skipped |
  error` (REST today; the offline queue and socket ack plug in here), `loadMe()`.

`LiveState` (see `reducer.ts`): `role`, `presentationId`, `connected`, `status`, `title`,
`joinCode`, `totalSlides`, `currentSlideIndex`, `deck` (host only, answer keys included), `slide`
(participant, sanitized; a leaderboard slide is synthesized), `timing {endsAt, serverNow}`,
`reveal`, `distribution` (host only), `answeredCount`, `participants`, `leaderboard`, `self`,
`me`, `submittedSlideIndex`, `modules`.

`liveReducer(state, action)` is pure. Actions:

| Action | From |
| --- | --- |
| `live/reset`, `live/connection` | shells, `useLiveSocket` |
| `live/event {event}` | `useLiveSocket` — every realtime envelope for this deck |
| `live/module {prefix, name, payload}` | a feature module's own actions |
| `host/state-loaded`, `host/lobby-opened`, `host/advanced`, `host/ended` | `useHostSession` |
| `participant/info-loaded`, `participant/joined`, `participant/me-loaded`, `participant/submitted` | participant shell, store actions |

Side effects stay out of the reducer: the host re-reads host state after
`question:started|revealed`, `leaderboard:shown`, `quiz:ended`; the participant refreshes `me`
after reveal/leaderboard/end and drops its stored identity on `lobby:opened`.

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

Same `id` again replaces the entry. Slot components read anything else from `useLive`. The props
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
- The shell already renders a non-`response` slide's ParticipantView; participants see a content
  slide once the reducer sets `slide` from `slide:shown` (W1-A2; until then they keep their
  previous screen while the stage shows content).
- `components/stage/StageView.tsx` is the convenience wrapper: `<StageView slide mode="thumbnail" />`
  defaults the data props. The builder's `SlideThumbnail` renders it on a 960×540 stage scaled
  to the rail.
- Views use `next-intl` and the deck tokens: render them inside `LiveIntlProvider` (the live
  routes and `SlideThumbnail` do).

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
- `live.json` holds the participant-facing strings (join page, participant shell, slide answer
  forms, leaderboard, timer, content slides: `slides.content.lookAtScreen*`,
  `slides.{image,video,instructions}.*`). Host chrome and stage labels are still English literals.

## Tests

- Unit (`bun run test`): `tests/unit/live.reducer.test.ts`, `live.store-and-slots.test.tsx`,
  `slides.runtime.test.tsx`, `slides.content.test.tsx` (content editors, markdown-lite escaping,
  participant modes, stage layouts), `media.test.tsx` (video links, embeds, upload checks, CSP),
  `theme.tokens.test.ts`.
- E2E (`bun run test:e2e`): `e2e/live-flow.spec.ts`, `e2e/content-slides.spec.ts` — see
  [`../testing/e2e.md`](../testing/e2e.md).
