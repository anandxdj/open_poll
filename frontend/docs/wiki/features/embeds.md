---
summary: Embeds (W4-D) — the /embed pages (live, results, stage), postMessage resize, the embed proxy step and framing headers, the screen stage, the Embed dialog, screen links, the workspace's embedding sites, and the add-in panes.
status: active
last_updated: 2026-11-05
---

# Embeds (`features/embeds/`, W4-D)

A deck's participant view, its live stage and a session's shared results can be shown on other
sites, room screens and in PowerPoint, Teams and Zoom. Backend contract (policy, oEmbed, screen
tokens, the stage-safe state, the `screen` socket role): `backend/docs/wiki/modules/embeds.md`.
Integration setup: `docs/integrations/*.md`.

**Embedding is off per deck by default** (`settings.embed.allowed`). The workspace may limit the sites
that frame its embeds (Settings → Workspace → Embedding); none listed = any site.

## Pages

| Route | Shows | Root |
| --- | --- | --- |
| `/embed/live/[code]` | `ParticipantShell` (join, answer, results), chromeless | `EmbedFrame kind="live" fit="content"` |
| `/embed/results/[token]` | `ResultsEmbed`: `PublicResultsContent` of `/r/[token]` + "Made with Open Poll" (hidden on a white-label custom domain) | `EmbedFrame kind="results" fit="content"` |
| `/embed/stage/[id]?token=` | `ScreenStage`: the deck's stage, read-only, through a screen token | `EmbedFrame kind="stage" fit="viewport"` |

- `app/embed/layout.tsx`: `noindex`, `referrer: no-referrer` (a stage URL carries a screen token),
  `EmbedIntlProvider` (namespaces `embeds`, `live`, `presenter`, `qna`, `sessions`, `slidesAdvanced`).
  No sidebar, no header: the root layout only adds the theme and the toaster.
- Each page is a server component that reads the proxy's verdict (`embedNotice()` in `verdict.ts`,
  request header `x-openpoll-embed`) and renders `EmbedNotice` instead of the content when the deck
  does not allow embedding ("Embedding is turned off") or the link leads nowhere ("This embed isn't
  available"). No verdict (the proxy did not run) renders nothing either.
- **Resize.** `EmbedFrame` (client) measures its root with a `ResizeObserver` and, inside a frame,
  posts `{type: "openpoll:embed:resize", kind, height}` to `window.parent` (`"*"`: only a height)
  whenever it changes. `fit="content"` sets `data-embed-root="content"`, under which
  `globals.css` turns off `min-h-screen`/`min-h-dvh` (full-screen surfaces would otherwise keep the
  frame from ever shrinking). `fit="viewport"` fills the frame (`h-dvh`): the host sizes the stage.
  The host page applies the height with the snippet from `resizeScript(origin)` (Embed dialog,
  "Fit the frame to its content"), which only trusts our origin.

## Framing (`lib/proxy/embeds.ts`, `lib/security/headers.ts`)

- `next.config.ts` headers: the baseline (with `frame-ancestors 'self'`) applies to every path
  **except** `/embed/*` (source `/:path((?!embed(?:/|$)).*)`); `/embed/*` gets the baseline without a
  CSP. Browsers enforce every CSP header a response has, so a looser second header would not help.
- `embedsProxy` (in `PROXY_CHAIN` after `domainsProxy`, before `authProxy`): for `/embed/*` it asks
  `GET /api/embeds/policy?kind&id&token` (answers cached 10 s per target; a failure denies and is
  not cached), then sets `Content-Security-Policy` = the baseline directives with
  `frame-ancestors <the workspace's sites | *>` when allowed, `'self'` when not (a denied embed never
  renders inside another site), plus `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`
  and the request header `x-openpoll-embed: allowed | EMBED_DISABLED | NOT_FOUND` for the page.
  Every other path keeps its framing protection unchanged.
- Add-in panes: `/addins/*` (not Zoom) get `frame-ancestors 'self'` + the Microsoft 365 hosts
  (`MICROSOFT_FRAME_ANCESTORS`: `*.office.com`, `*.officeapps.live.com`, `teams.microsoft.com`,
  `*.teams.microsoft.com`, `*.sharepoint.com`, `*.cloud.microsoft`, `*.skype.com`, …); `/addins/zoom`
  gets the OWASP headers Zoom Apps check (`ZOOM_HEADERS`: CSP, HSTS, nosniff, Referrer-Policy).

## Screen stage (`components/ScreenStage.tsx`, `useScreenSession.ts`)

The host console's `Stage` with `surface="screen"` and no actions, over its own live store. The store
is a **host** store (`createLiveStore("host")`): the screen state has the host state's shape, so the
reducer is reused; nothing on this surface can send a host command.

- `useScreenSession(presentationId, screenToken)` reads `GET /api/embeds/stage` (`api.ts`
  `getScreenState`: a plain axios client, no credentials, the token in `X-Screen-Token`) into the store
  (`resync` + `host/state-loaded`), joins with `useLiveSocket(…, {role: "screen", screenToken})` and
  re-reads on every (re)join, return to the tab, `seq` reset, foreign session, and on
  `question:started`, `slide:closed` and `question:revealed` (a revealed slide's answer key only
  comes with the state). A `seq` gap is **not** a reason: a screen does not get every host event.
- Problems: 404 → "This embed isn't available"; 403 → "Embedding is turned off"; the socket's
  `screen:revoked` → "This screen link was turned off" (`reason: revoked`) or "Embedding is turned off"
  (`reason: embed_disabled`, the deck stopped allowing embedding: every screen goes at once); a failed
  first load → retry button. A token of another deck than the URL's is treated as not found.
- The state carries the session's public Q&A (`qna`): after each load it is dispatched into the Q&A
  slice (`qnaActions.loadedForParticipant`), so a screen that joins mid-session shows the approved and
  highlighted questions at once, then follows the `qna:*` events.
- Stage differences on a screen: `StageReady` without actions says "Waiting for the presenter to
  begin."; `StageEnd` shows no `endScreen` slot entries (their host links lead to signed-in pages).
  Q&A on a screen comes from the screen state (public questions only) plus the `all` events.

## Embed dialog (`components/EmbedDialog.tsx`)

From the library card menu of a deck (**Embed…**) and the builder header (**Embed**, existing decks),
for roles that may manage it (`useCanEmbedDecks`: owner, admin, editor of the selected workspace,
personal ones included; the API decides anyway).

- **Allow embedding** switch (`PATCH /api/presentations/:id {settings: {embed: {allowed}}}`; it works
  while a session is live too, the one deck setting that does; turning it off blanks every connected
  screen at once), with which sites may embed when the workspace detail is loaded and a link to
  Settings → Workspace → Embedding.
- **Participant view**: embed code (`iframeSnippet`, the same markup oEmbed returns), page link,
  oEmbed URL, and the optional resize script.
- **Stage for screens** (`ScreenLinks.tsx`): create a screen link with a name (its URL, stage embed
  code and oEmbed URL are shown once: "Copy its link now: it won't be shown again"), the list
  (name, `prefix…last4`, last used), **Turn off** with an in-place confirmation ("Turn off? Its
  screens go blank.") — never `confirm()`.
- Results are embedded from the session's **Share** dialog (`features/sessions`): once the public
  link is on, it shows the results embed code.

`CopyField` is the read-only field + copy button these use. `embedUrls.ts` holds the URL builders,
the snippet, the resize message type and script (pure, unit tested).

## Workspace setting (`components/EmbeddingSitesSection.tsx`)

Settings → Workspace, section `#embedding`: the list of sites with remove buttons and an "Add a site"
field (`normalizeSite` in `sites.ts` mirrors the API's rule: origin or `https://*.domain`, a missing
scheme means https, up to 20), saved with `PATCH /api/workspaces/:id {settings: {embedAllowedOrigins}}`.
Owners and admins only (`workspace:manage`); others read it.

## Add-in panes (`features/embeds/addins/`, `app/addins/*`)

Pages Office, Teams and Zoom load. Each asks once for a **screen link** (`ScreenLinkForm`;
`parseScreenLink` in `screenLink.ts` accepts only this site's `/embed/stage/<id>?token=scr_…`), keeps
it, and draws that deck's stage with `ScreenStage` (`AddinStage`, with a "Change screen link" bar).
`app/addins/layout.tsx`: noindex, no referrer, `EmbedIntlProvider`. Framing: see "Framing" above.

| Route | Component | Notes |
| --- | --- | --- |
| `/addins/powerpoint` | `PowerPointPane` | Task pane. Loads Office.js (`loadScript`, which also restores the `history` methods Office.js nulls in some hosts); inside PowerPoint the link is kept in the document settings (`openpollScreenLink`, travels with the file), else in localStorage. |
| `/addins/teams/config` | `TeamsConfig` | Tab configuration: on a valid link it registers the save handler (`pages.config.setConfig` with `contentUrl` = the side panel page) and sets validity. Outside Teams it shows the tab address. |
| `/addins/teams/sidepanel?link=` | `TeamsSidePanel` | Meeting side panel: the deck's participant view (`ParticipantShell`, join code read from the screen state) and "Show on meeting stage" (`meeting.shareAppContentToStage`, enabled only in a `sidePanel` frame context). In a chat/channel tab (`content`) it shows the stage. |
| `/addins/teams/stage?link=` | `TeamsStage` | What the side panel shares to the meeting stage. |
| `/addins/zoom` | `ZoomPane` | The Zoom App's home page (link in localStorage); Zoom's OWASP headers. |

The host SDKs come from Microsoft's CDNs (`OFFICE_JS`, `TEAMS_JS` in `loadScript.ts`) and are optional:
without them (a plain browser, no network) every pane still works, minus the host's extras
(`connectTeams()` gives up after 3 s). Manifests: `addins/powerpoint/manifest.template.xml`,
`addins/teams/manifest.template.json` (+ `addins/teams/icons/`, drawn by `addins/scripts/make-icons.ts`,
which also writes the Office icons to `public/addins/icons/`), built and checked by
`addins/scripts/build-manifests.ts`. Setup: `docs/integrations/{powerpoint,teams,zoom}.md`.

## Tests

- Unit: `tests/unit/embeds.test.ts` (URLs, snippet escaping, resize message and script, sites,
  verdict, the next.config header rules, `embedCsp`, the proxy step with a stubbed policy API:
  allowed, denied, API failure not cached, malformed path).
- Unit: `tests/unit/addins.test.ts` (screen links, the Teams page URLs, both manifests rendered and
  checked, the checks catching broken manifests, the Teams ZIP).
- E2E: `e2e/embeds.spec.ts`, `e2e/addins.spec.ts` (see `../testing/e2e.md`).
