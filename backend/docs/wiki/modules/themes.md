---
summary: Themes and brand kits (W3-A): presets, brand kit CRUD with contrast checks, deck themes, the workspace default and the session snapshot.
status: active
last_updated: 2026-10-26
---

# Themes and brand kits (`src/modules/themes/`)

A deck's look on the projected screen and phones. Decks store a reference
(`presentation.theme = {presetId, brandKitId, overrides}`); a session resolves it when it opens and
keeps the tokens in `session.themeSnapshot`, so later edits never restyle a past session.

## Files

| File | Role |
| --- | --- |
| `presets.ts` | `THEME_PRESETS`: Graph paper (`graph-paper`, the default and the built-in look), Ocean, Forest, Grape, Mono, Classic; all dark stages. `knownPresetId` (the old default `amber` maps to `graph-paper`), `presetFor`. |
| `contrast.ts` | WCAG 2.1 ratios. `contrastFailures(colors)`: text, muted text on the stage and text on panels 4.5:1, text on the accent 4.5:1, accent / correct / incorrect against the stage 3:1. |
| `fonts.ts` | `FONT_CHOICES`: `System` plus 15 Google Fonts families. `themeFont(choice)` builds the CSS stack and the fonts.googleapis.com URL; no other URL is ever produced. |
| `brandKit.model.ts` | `BrandKit {workspaceId, name, colors, fonts {heading, body}, logo {url, alt} \| null, background {imageUrl, overlayOpacity} \| null, createdBy}`, up to 20 per workspace. Migration 170. |
| `resolve.ts` | `ThemeTokens` (`presetId, brandKitId, custom, name, colors, fonts, logo, background`), `buildTokens`, `resolveTheme(ref, {workspaceId, brandKits})` (preset, then the kit when it belongs to the workspace and the plan has `brand_kits`, then the overrides), `resolveDeckTheme(deck)`. |
| `themes.service.ts` | `BrandKitService` CRUD, `assertReadable`, `assertThemeChoice` (deck and workspace default checks), `presetViews`. |

`custom: false` means the default preset with no kit and no overrides: the frontend then keeps its
built-in tokens (the audience surfaces follow the app's light or dark theme).

## Routes

| Route | Guard | What |
| --- | --- | --- |
| `GET /api/themes/presets` | signed in (allow-listed) | `{presets: [{id, name, tokens}], fonts}` |
| `GET /api/brand-kits`, `GET /api/brand-kits/:id` | `workspaceContext`, `brand_kits`, `deck:read` | kits with their resolved `tokens` |
| `POST /api/brand-kits` | + `workspace:brand` | 400 `LOW_CONTRAST` with `details.failures`, 409 `BRAND_KIT_LIMIT` |
| `PATCH /api/brand-kits/:id` | + `workspace:brand` | any field; colours replaced whole and checked |
| `DELETE /api/brand-kits/:id` | + `workspace:brand` | decks and the workspace default using it fall back to their preset |

Every brand kit route needs `brand_kits` (403 `FEATURE_NOT_IN_PLAN` on Free). Another workspace's kit
is 404 (`BRAND_KIT_NOT_FOUND`). Audit: `brand_kit.create|update|delete`.

## Deck and workspace themes

- `PATCH /api/presentations/:id` `theme: {presetId?, brandKitId? (id | null), overrides? ({accent, accentText} | null)}`:
  unknown preset 400 `UNKNOWN_THEME`; a kit needs `brand_kits` and the deck's workspace; overrides set
  both colours and keep 4.5:1 (400 `LOW_CONTRAST`). Fields are replaced, not merged.
- `PATCH /api/workspaces/:id` `settings.defaultTheme: {presetId, brandKitId} | null` (`workspace:brand`):
  new decks start with it unless the create request sends a theme.
- A deck whose workspace lost `brand_kits` resolves to its preset at the next session.

## Live surfaces

`themeSnapshot` is in the participant `live-state` (`theme`), the host `SessionView` (`theme`) and the
code lookup `GET /api/presentations/code/:code` (`theme` of the live session, for the join screen).

## Tests

`tests/themes.test.ts` (ratios, presets readable, aliases, font URLs, `custom`, overrides) and
`tests/integration/brand-kits.test.ts` (presets, plan gate, CRUD with contrast, bad input, workspace
isolation, deck theme and snapshot, downgrade fallback, workspace default).
