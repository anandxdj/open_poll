---
summary: Embeds, oEmbed and screens (W4-D) — the embed policy, oEmbed provider, screen tokens, the stage-safe screen state and the `screen` socket role.
status: active
last_updated: 2026-11-05
---

# Embeds, oEmbed and screens (`modules/embeds/`, W4-D)

Three things can be shown outside Open Poll, each a chromeless page of the frontend under `/embed/*`
(frontend side: `frontend/docs/wiki/features/embeds.md`):

| Kind | Page | Identified by | Data it reads |
| --- | --- | --- | --- |
| `live` | `/embed/live/<code>` (also `/live/<code>` for oEmbed) | the deck's join code | the public participant API, as `/live/<code>` |
| `results` | `/embed/results/<token>` (also `/r/<token>`) | a public results link (`sessions.md`) | `GET /api/public/results/:token` |
| `stage` | `/embed/stage/<deckId>?token=<screen token>` | a screen token of that deck | `GET /api/embeds/stage` and the `screen` socket role |

**Embedding is off by default** (`settings.embed.allowed`, deck setting, `deck:edit`). It is the one
deck setting that may change **while a session is live** (`isEmbedOnlyPatch` in
`presentations/crud.service.ts`: a patch of `settings.embed` alone, written with one atomic `$set`
so it never races the host commands' deck mirror; any other field in the same patch is still the
400 of the live freeze). While it is off, oEmbed refuses the deck (403 `EMBED_DISABLED`), the
embed policy says `allowed: false` (so the frontend never lets another site frame the page and the
page shows "Embedding is turned off"), and screen tokens stop working at once (stage read 403,
socket join and resync `FORBIDDEN`: every check reads the deck). Turning it off also **sends the
deck's connected screens away** on every instance (`embeds:screen-revoked` without a token, reason
`embed_disabled`, see Screen tokens). The tokens themselves stay: turning embedding back on makes
the same links work again. Creating screen tokens works either way. The deck's workspace may limit which sites may frame its embeds
(`settings.embedAllowedOrigins`, `PATCH /api/workspaces/:id`, `workspace:manage`, up to 20); an empty
list means any site. Entries are origins (`https://example.com`, a port allowed, `http://` outside
production) or every subdomain of a domain (`https://*.example.com`), normalised by `origins.ts`
(`parseOrigin`); anything else is a 400.

## Files

| File | Role |
| --- | --- |
| `embeds.route.ts` | `/api/embeds` router (screen tokens, stage, policy) and `oembedRouter` (`/api/oembed`). |
| `embeds.controller.ts` | Query parsing, envelopes; oEmbed answers the bare oEmbed JSON (no `{success, data}`). |
| `embeds.schema.ts` | Zod: create-token body, list/policy/oEmbed queries. |
| `screenToken.model.ts` | `ScreenToken` (collection `screentokens`). |
| `screenTokens.service.ts` | Create, list, revoke; `resolveScreenToken`, `authorizeScreen`, `isEmbedAllowed`. |
| `stage.service.ts` | The screen state (`toScreenState`, `getScreenStateByToken`, `getScreenState`). |
| `stageSafe.ts` | Pure: `stageSafeSlide`, `stripAnswerKeys`. |
| `policy.service.ts` | Embed URLs, `getEmbedPolicy`, `getOEmbed`, `fitSize`, `iframeHtml`. |
| `origins.ts` | `parseOrigin`, `normalizeOrigins` (also used by the workspace PATCH schema). |
| `screenSockets.ts` | `screenTokensOf(socket)`: the screen tokens a socket joined with, by deck. |
| `embeds.socket.ts` | Socket module `embeds`: the `embeds:screen-revoked` channel. |

## API

| Route | Auth | Response |
| --- | --- | --- |
| `GET /api/oembed?url&format=json&maxwidth&maxheight` | public, any origin (`cors()` without credentials, mounted before the CORS allow-list), 300/min per IP | oEmbed 1.0 `rich`: `{version, type, provider_name: 'Open Poll', provider_url, title, html, width, height, cache_age: 3600}`. 404 for a URL that is not an embeddable page of this site (another host, another path, a malformed id, a dead link), 403 `EMBED_DISABLED`, 501 for `format` other than `json`, 400 without `url`. |
| `GET /api/embeds/policy?kind&id&token` | public, 3000/min per IP (the frontend proxy asks from its own address) | `{allowed, reason: 'NOT_FOUND' \| 'EMBED_DISABLED' \| null, frameAncestors: ['*'] \| [origins]}` — always 200. |
| `GET /api/embeds/screen-tokens?presentationId` | `authenticate → workspaceContext`, `deck:share` | `ScreenTokenView[]` (active only, newest first, never the token): `{id, presentationId, label, prefix, last4, lastUsedAt, createdAt}`. |
| `POST /api/embeds/screen-tokens` | same, 30/min per user | `{presentationId, label (1–80)}` → 201 `ScreenTokenView & {token}`. The token is shown **once**. 409 `SCREEN_TOKEN_LIMIT` past 20 active tokens per deck. |
| `DELETE /api/embeds/screen-tokens/:id` | same | `{id, revoked: true}`; 404 for an unknown token **and** for a token of a deck the caller may not manage (no existence leak). |
| `GET /api/embeds/stage` | `X-Screen-Token` header, 600/min per IP, `Cache-Control: no-store` | `ScreenStateResponse` (below). 404 for a token that does not work, 403 `EMBED_DISABLED`. |

Accepted oEmbed URLs: `/embed/live/<code>`, `/live/<code>`, `/embed/results/<token>`, `/r/<token>`,
`/embed/stage/<deckId>?token=<scr_…>`, on the frontend's origin (`FRONTEND_URL`) or on an active
custom domain (W4-E) **of the deck's own workspace**. The iframe `src` is always the `/embed/...`
page on the requested origin. Default sizes: live 420×640, results 800×900, stage 960×540
(`maxwidth`/`maxheight` shrink it, the stage keeps 16:9, clamped to 200–4000). The `title` is the
deck's (results: "<deck> — results").

Tenancy: the token routes run the workspace context; `/api/oembed`, `/api/embeds/policy` and
`/api/embeds/stage` are on the allow-list of `tests/integration/tenancy-isolation.test.ts` with their
reasons (public by design; the screen token is the credential).

## Screen tokens

`ScreenToken {workspaceId, presentationId, label, tokenHash, prefix, last4, createdBy, lastUsedAt,
revokedAt}`; indexes `tokenHash` unique, `{presentationId, createdAt}`, `workspaceId` (migration 220).

- Token: `scr_` + 32 random bytes base64url (47 characters). Only `sha256(token)` is stored;
  `prefix` (8) and `last4` tell tokens apart in lists.
- Managing tokens needs `deck:share` on the deck (owner, admin, editor roles; not presenters or
  viewers, not share grants, which never carry `deck:share`). Cross-workspace requests get the
  policy's 403/404, revokes a plain 404.
- A token reads one deck only, and only while the deck is not in the trash, still in the token's
  workspace and allows embedding. `lastUsedAt` is written at most every 5 minutes.
- **Revoke** sets `revokedAt` and publishes `embeds:screen-revoked {presentationId, tokenId, reason:
  'revoked'}` on Redis (`announceScreensRevoked`). Every instance (socket module `embeds`) removes
  its own sockets that joined that deck with that token from the deck's rooms and emits
  `screen:revoked {presentationId, reason}` to them. The same message **without** `tokenId` (reason
  `embed_disabled`, published by `updatePresentation` when a patch sets `settings.embed.allowed:
  false`) removes every screen of the deck. The next stage read, join or resync is refused anyway.
- Audit: `embed.screen_token_create`, `embed.screen_token_revoke` (target `screen_token`, meta
  `{presentationId, label}`).

## The screen state (stage-safe)

A screen token can end up on a public web page, so a screen sees what the stage shows, never
what the host console keeps to itself until the reveal. `ScreenStateResponse` has the host state's
shape (`HostStateResponse`, `presentations-live.md`), built by the same code
(`buildDeckLiveState` in `live/session.service.ts`, shared with `getHostState`), then:

- `presentation` is a **screen deck**: `_id, title, joinCode, status, pace, currentSlideIndex,
  settings, slides` — no creator, workspace, theme selection or legacy fields.
- Every slide loses its **notes**. A **response slide not yet revealed** in the session the screen
  follows (`slideStates[slideId].revealedAt` unset) also loses its **answer key**
  (`stageSafeSlide`): options all `isCorrect: false`, `acceptedAnswers` empty, `config` and `content`
  replaced by the type's participant allow-list (`sanitize`), `select_answer` keeping only
  `allowMultiple`. Revealed slides come whole (minus notes): the stage marks correct answers.
- Results of unrevealed slides (`liveDistribution`, `distributions`) keep their counts but go through
  `stripAnswerKeys`, which neutralises the fields that carry a key: `isCorrect` → false,
  `acceptedAnswers` → [], `correct`, `tolerance`, `correctCount`, `region`, `inRegion` → null, at any
  depth. A new response type that reports its key under another name must add it there
  (`tests/embeds.stageSafe.test.ts` runs every registered response type and fails until its
  fixture exists).
- `session.hostUserId` is null.
- `qna`: the followed session's **public Q&A** (`listForScreen` in `qna.service.ts`: visible and
  answered questions, `highlightedId`, the Q&A settings view; the participant list's shape with
  `mine`/`upvoted` false; never pending questions, never participant ids), so a screen that joins
  mid-session shows what is already approved and on screen, then follows the `qna:*` events. Null
  without a session.

## The `screen` socket role

`live:join {presentationId, role: 'screen', screenToken}` (presentations socket module): the token
must be a live token of **that** deck and the deck must allow embedding, else `FORBIDDEN`
(`INVALID_PAYLOAD` without a token). A screen joins `live:{pid}` (every `all` event) and
`live:{pid}:screen` — **never** the host room — and is recorded in `screenTokensOf(socket)`.
`live:resync {presentationId, role: 'screen', screenToken}` acks `{ok, role: 'screen', seq, state}`
with the screen state. The legacy `quiz:join` does not know screens. A screen cannot answer
(`answer:submit` is 403 `NOT_JOINED`) or send host commands (those are HTTP with a user).

Host-audience events reach the screen room only through a **screen view** registered by the
module that owns the event (`common/realtime/screenViews.ts`, see `realtime/envelope.md`):

| Event | Screen view |
| --- | --- |
| `answer:received` | `stripAnswerKeys(payload)` (live counts without the key; registered in `presentations.socket.ts`) |
| `reaction:burst` | as is (registered in `reactions.socket.ts`) |
| `qna:question` | none (questions waiting for moderation stay with the host) |

## Add-in panes

The PowerPoint, Teams and Zoom panes (`frontend/app/addins/*`, `docs/integrations/*.md`) need no API of
their own: they take a screen link and use `GET /api/embeds/stage` and the `screen` role like the
stage embed (the Teams side panel reads the deck's join code from the screen state and then uses the
public participant API). Embedding must be on for the deck.

## Tests

- Unit: `tests/embeds.stageSafe.test.ts` (every response type: notes and keys gone before the reveal,
  all there after; distributions keep counts, lose keys), `tests/embeds.policy.test.ts` (URL parsing,
  sizes, iframe escaping, origins, the workspace setting), `tests/realtime.deliver.test.ts` (screen
  views), `tests/realtime.modules.test.ts`.
- Integration: `tests/integration/embeds.test.ts` — oEmbed for each kind and URL form, any-origin CORS,
  refusals (other sites, other pages, dead links, revoked token, `format=xml`, embedding off); screen
  tokens (hash at rest, list without secret, presenter and other-workspace refusals, stage refused
  while embedding is off then stage-safe, a live session followed over the socket with the key
  stripped until the reveal, resync, no answering, wrong deck/token refused, revoke with the
  connected screen kicked and another token kept); embedding turned off kicks every screen of the
  deck (not another deck's) and refuses at once, back on works again; the embed switch accepted
  mid-session (mirror untouched) while every other edit stays refused; the screen state's Q&A
  (pending left out, approved and highlighted in, also over `live:resync`); the policy per kind and
  the workspace's sites. Unit: `isEmbedOnlyPatch` in `tests/embeds.policy.test.ts`.
