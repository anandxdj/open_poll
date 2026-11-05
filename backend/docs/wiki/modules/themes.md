---
summary: Themes and brand kits (W3-A) with light and dark decks: presets in both modes, the deck's stored mode, brand kit CRUD with contrast checks, the workspace default, resolved tokens on deck answers and the session snapshot.
status: active
last_updated: 2026-11-05
---

# Themes and brand kits (`src/modules/themes/`)

A deck's look on the projected screen, the phones and the builder. Decks store a reference
(`presentation.theme = {presetId, mode, brandKitId, overrides}`); a session resolves it when it opens
and keeps the tokens in `session.themeSnapshot`, so later edits never restyle a running session or a
past session's report.

## Light and dark (`theme.mode`)

- Every deck is `light` or `dark`. **Light is the default**, like the app (Graph paper is light-first).
- A new deck stores the mode the create request sends; without one it is light. The builder sends the
  creator's app theme (`next-themes` resolved theme) on every create path: `POST /api/presentations`
  `theme.mode`, `POST /api/ai/generate-deck` `themeMode`, `POST /api/imports` and
  `POST /api/imports/questions` `themeMode` (stored on the import job, applied when the worker creates
  the deck), `POST /api/templates/:id/use` `themeMode`, `POST /api/library/convert/poll/:id?themeMode=`.
  MCP, scripts and API clients that send none get light.
- Duplicate and Save as template keep the source's mode; Use template takes the request's `themeMode`
  (a starter without one is light, a workspace template without one keeps its own).
- A brand kit has one palette, so it brings its own mode: `paletteMode(kit.colors.background)` (light
  when dark text reads better on the stage colour). While a deck uses a kit, its stored mode only
  matters if the kit goes away (the deck falls back to its preset in that mode).
- Decks stored before modes have none: the schema default and `resolveTheme` read that as light.
  Migration 240 stored the mode of every existing deck: `dark` for decks that chose a look (another
  preset, a brand kit or an accent override; they chose it on the dark stage), `light` for the plain
  default.
- Session snapshots taken before modes have no `mode`; the frontend draws them dark, as they ran.

## Files

| File | Role |
| --- | --- |
| `presets.ts` | `THEME_MODES` (`light`, `dark`), `DEFAULT_THEME_MODE` (`light`), `THEME_PRESETS`: Graph paper (`graph-paper`, the default and the built-in look), Ocean, Forest, Grape, Mono, Classic, each with `palettes.light` and `palettes.dark`. Graph paper light is the app's light tokens (paper `#f6f6f3`, white sheets, ink `#171717`, ember `#cf460c` with white text); light charts use the 700/800 steps of the categorical hues. `knownPresetId` (the old default `amber` maps to `graph-paper`), `presetFor`, `knownThemeMode`, `themeModeOf` (unknown → light), `presetSource(preset, mode)`. |
| `contrast.ts` | WCAG 2.1 ratios. `contrastFailures(colors)`: text, muted text on the stage and text on panels 4.5:1, text on the accent 4.5:1, accent / correct / incorrect against the stage 3:1. `chartContrastFailures(colors)`: every chart / word cloud colour 3:1 against the stage (presets only; kits are not held to it). `paletteMode(background)`. |
| `fonts.ts` | `FONT_CHOICES`: `System` plus 15 Google Fonts families. `themeFont(choice)` builds the CSS stack and the fonts.googleapis.com URL; no other URL is ever produced. |
| `brandKit.model.ts` | `BrandKit {workspaceId, name, colors, fonts {heading, body}, logo {url, alt} \| null, background {imageUrl, overlayOpacity} \| null, createdBy}`, up to 20 per workspace. Migration 170. |
| `resolve.ts` | `ThemeTokens` (`presetId, mode, brandKitId, custom, name, colors, fonts, logo, background`), `buildTokens(source, presetId, kitId, overrides, mode = paletteMode)`, `presetTokens(presetId, mode, overrides)`, `resolveTheme(ref, {workspaceId, brandKits})` (preset in the ref's mode, then the kit when it belongs to the workspace and the plan has `brand_kits`, then the overrides), `resolveDeckTheme(deck)`. |
| `themes.service.ts` | `BrandKitService` CRUD, `assertReadable`, `assertThemeChoice` (deck and workspace default checks; `mode` must be light or dark), `presetViews` (`tokens` light plus `modes.{light,dark}`). |

`custom: false` means the default preset with no kit and no overrides, in either mode: the frontend then
draws its built-in Graph paper tokens of that mode (`frontend/features/presentations/theme/tokens.css`).

## Routes

| Route | Guard | What |
| --- | --- | --- |
| `GET /api/themes/presets` | signed in (allow-listed) | `{presets: [{id, name, tokens, modes: {light, dark}}], fonts}` (`tokens` is the light one) |
| `GET /api/brand-kits`, `GET /api/brand-kits/:id` | `workspaceContext`, `brand_kits`, `deck:read` | kits with their resolved `tokens` (mode from the kit's stage colour) |
| `POST /api/brand-kits` | + `workspace:brand` | 400 `LOW_CONTRAST` with `details.failures`, 409 `BRAND_KIT_LIMIT` |
| `PATCH /api/brand-kits/:id` | + `workspace:brand` | any field; colours replaced whole and checked |
| `DELETE /api/brand-kits/:id` | + `workspace:brand` | decks and the workspace default using it fall back to their preset |

Every brand kit route needs `brand_kits` (403 `FEATURE_NOT_IN_PLAN` on Free). Another workspace's kit
is 404 (`BRAND_KIT_NOT_FOUND`). Audit: `brand_kit.create|update|delete`.

## Deck and workspace themes

- `PATCH /api/presentations/:id` `theme: {presetId?, mode? ('light' | 'dark'), brandKitId? (id | null), overrides? ({accent, accentText} | null)}`:
  unknown preset 400 `UNKNOWN_THEME`; another mode 400; a kit needs `brand_kits` and the deck's
  workspace; overrides set both colours and keep 4.5:1 (400 `LOW_CONTRAST`). Fields are replaced, not
  merged; changing the preset keeps the mode. Theme saves do not bump the deck `revision`. A live deck
  is not edited (400), theme included.
- `POST /api/presentations` `theme`: a request that picks no preset or kit starts on the workspace
  default look (`settings.defaultTheme`) with the request's mode (default light).
- `PATCH /api/workspaces/:id` `settings.defaultTheme: {presetId, brandKitId} | null` (`workspace:brand`):
  new decks start with it unless the create request picks a look. Light or dark stays each creator's.
- A deck whose workspace lost `brand_kits` resolves to its preset at the next session.

## Where resolved tokens go

- Deck answers: `POST /api/presentations`, `GET/PATCH /api/presentations/:id` and
  `POST /:id/duplicate` add `themeTokens` (the deck's theme resolved now): the builder draws its
  canvas and thumbnails with it.
- Host state (`GET /:id/host/state`) and the screen state (`GET /api/embeds/stage`): `deckTheme`, the
  deck's theme as it is now (the stage draws it while no session is live), next to `session.theme`,
  the snapshot a live session draws.
- `themeSnapshot` is in the participant `live-state` (`theme`), the host `SessionView` (`theme`), the
  code lookup `GET /api/presentations/code/:code` (`theme` of the live session, for the join screen),
  the session report and the public results (`theme`).
- Phone remote state (`GET /api/remote/:token/state` and the socket acks): `theme`, the live session's
  snapshot, else the deck's current theme.
- Library cards (`GET /api/library`) of decks: `details.theme` = `{mode, custom, background, surface,
  text, mutedText, accent, accentText}` for the mini screen (one brand kit query per page, only when the
  plan has kits).

## Tests

`tests/themes.test.ts` (ratios, every preset readable in both modes, chart colours 3:1 on their stage
and 4.5:1 on the light ones, palette modes, Graph paper light = the app paper, aliases, light default,
font URLs, `custom` in both modes, overrides, kit mode, preset views), `tests/library.query.test.ts`
(card theme preview), `tests/integration/brand-kits.test.ts` (presets, plan gate, CRUD with contrast,
bad input, workspace isolation, deck theme and snapshot, downgrade fallback, workspace default) and
`tests/integration/deck-theme-mode.test.ts` (light by default, explicit mode kept, workspace default
look with the creator's mode, mode switch without a revision bump, duplicate / save as template / use
template, AI deck, snapshot kept by a running session, host `deckTheme`, remote theme, library preview,
migration 240 run twice).
