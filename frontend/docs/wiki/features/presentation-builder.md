---
summary: Deck builder layout, the slide meta and editor registries, inspector tabs, and slide-rail operations.
status: active
last_updated: 2026-10-19
---

# Presentation Builder

Route `/presentation/create` (`app/(dashboard)/presentation/create/page.tsx`, `?id=` edits a deck,
`?name=&mode=ai` seeds a new one). Everything lives in `features/presentations/`.

## Layout

`components/PresentationBuilder.tsx` is a thin shell:

| Piece | File | Role |
| --- | --- | --- |
| State | `components/builder/useDeckBuilder.ts` | Deck + selected slide, local draft (localStorage), silent backend drafts, explicit save, AI generation. |
| Frame | `components/builder/BuilderShell.tsx` | Header on top, rail beside the inspector. |
| Header | `components/builder/BuilderHeader.tsx` | Title, AI generate, Save Draft, Create/Save. |
| Rail | `components/builder/SlideRail.tsx` | Thumbnails, select, reorder, duplicate, delete, "New slide" picker. |
| Inspector | `components/builder/Inspector.tsx` | Type badge + tabs from the `inspectorTabs` registry. |
| Pure helpers | `components/builder/{deckDraft,slideRailOps}.ts` | Validation, payloads, local draft, rail operations (unit tested). |

## Slide registries

Each slide type has a folder `slides/types/<type>/` (`select_answer`, `type_answer`, `wordcloud`,
`open_ended`, `scales`, `ranking`, `leaderboard`):

| File | Loaded by | Contents |
| --- | --- | --- |
| `meta.ts` | everyone | `SlideTypeMeta`: label, description, icon, section, scored, order. |
| `editor.tsx` | builder only | `SlideEditorDef` (below). |
| `participant.tsx`, `stage.tsx` | live routes | Runtime views, registered in `slides/runtime.ts`. |

`slides/meta.ts` and `slides/editor.ts` aggregate the per-type files, one line per type,
alphabetical.

### Meta (`slides/meta.ts`)

- `SLIDE_META[type]`, `slideTypeMeta(type)` — falls back to `select_answer` for unknown types.
- `section`: `interactive` | `competition` | `system`. `PICKER_SECTIONS` lists the sections the
  "New slide" picker shows, in order; `system` types (`leaderboard`) are never offered.
- `SLIDE_TYPE_META` — authorable types sorted by `order` (picker and AI modal use it).

### Editor contract (`slides/editor.ts`)

```ts
interface SlideEditorDef {
  meta: SlideTypeMeta;
  blank(): PresentationSlide;               // fresh slide from the picker
  Editor: ComponentType<{ slide; onChange(patch) }>; // type fields, under the question
  validate(slide): string | null;           // on a cleaned slide; lowercase, unprefixed
  clean(slide): PresentationSlide;          // drop blanks, clear other types' fields
  fillDraft(slide): PresentationSlide;      // fill gaps so a draft passes the API rules
}
```

Deck-level helpers dispatch through the registry: `blankSlide`, `cleanSlide`, `validateSlide`,
`normalizeSlideForDraft`. `validateDeck` (in `deckDraft.ts`) checks the title, then prefixes the
first slide error with `Slide N: `.

Shared pieces for editors are in `slides/editorKit.tsx`: `blankBase(meta)` (every field empty,
scoring from `meta.scored`), `cleanBase(slide, meta)`, `requireQuestion`, `padTo`, `FieldLabel`,
`RemoveEntryButton`, `EditorNote`.

**Adding a slide type:** create `slides/types/<type>/{meta.ts, editor.tsx}`, add one line to
`SLIDE_META` and one to `SLIDE_EDITORS`, and add the type to `PresentationSlideType` in
`types/deck.ts`. A new picker section is one entry in `PICKER_SECTIONS`.

### Bundle boundary

Live routes (`app/live/**`, `app/presentation/host/**`, `app/p/**`) and anything they import must
never import `slides/editor.ts`, `slides/editorKit.tsx`, a `types/<type>/editor.tsx` or
`components/builder/**`. `meta.ts` files stay free of editor code. `tests/unit/builder.bundle-boundary.test.ts`
walks the runtime import graph from every live entry point and fails on a violation.

## Inspector tabs (`components/builder/inspectorTabs.ts`)

```ts
interface InspectorTabDef {
  id: string; label: string; Icon: LucideIcon;
  order: number;                          // Content 10, Settings 20
  appliesTo?(slide): boolean;             // default: every slide
  Panel: ComponentType<InspectorTabProps>;
}
interface InspectorTabProps {
  slide; index; onChange(patch);          // the selected slide
  deck: DeckDraft; onDeckChange(patch);   // deck-level fields (not slides)
}
```

Built in: **Content** (`tabs/ContentTab.tsx`: question + the type's `Editor`) and **Settings**
(`tabs/SettingsTab.tsx`: time limit, points, speed bonus). A feature adds a tab by exporting an
`InspectorTabDef` and adding one line to `INSPECTOR_TABS` (alphabetical; `order` sets position).
A deck-level tab (e.g. a theme picker) reads `deck` and writes through `onDeckChange`; a new deck
field also needs a place in `DeckDraft`, `useDeckBuilder` and the save payloads.

The chosen tab stays selected while switching slides, and falls back to the first tab when it
doesn't apply. Tabs follow the WAI-ARIA tabs pattern (arrow keys, Home/End).

## Slide rail

- Operations are pure functions in `slideRailOps.ts` (`addSlide`, `moveSlide`, `duplicateSlide`,
  `removeSlide`) that return `{slides, active}` so the selection follows the edit. Duplicates are
  deep copies without `_id`. A deck always keeps one slide.
- Keyboard on a focused slide: ArrowUp/ArrowDown select previous/next, Home/End first/last,
  Alt+ArrowUp/Alt+ArrowDown move the slide. Moves, duplicates and deletes are announced in a
  polite live region.
- Thumbnails come from `components/builder/SlideThumbnail.tsx`, the only thumbnail renderer the
  builder imports. It draws a static preview from meta; it is the seam for the runtime
  `StageView mode="thumbnail"`.

## Saving

- Explicit save: `cleanSlide` every slide → `validateDeck` → create/update → `/polls`.
- Save Draft and the silent save on unmount/AI result: `normalizeSlideForDraft` fills gaps
  (`Untitled Question`, `Option N`, `Item N`, …) so the API accepts an unfinished deck.
- The local draft (localStorage key `openpoll_presentation_draft_<id|new>`) is written 250 ms after
  each edit and on `beforeunload`.
