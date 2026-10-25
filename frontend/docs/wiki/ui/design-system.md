---
summary: The Open Poll design foundation ("Graph paper": tokens, type, radius, spacing, motion, primitives) and the rules for marketing and sign-in surfaces.
status: active
last_updated: 2026-10-25
---

# Design system

"Graph paper": light-first warm paper and ink with a complete warm-graphite dark mode, one ember-orange
accent, Inter Tight. Restrained and precise: borders first, hairline graph-paper grids behind product
illustrations, shadows soft and rare. The tokens live in `app/globals.css` (`@theme inline` plus `:root`
and `.dark`); components read tokens, never raw hex. Live surfaces layer their `--deck-*` tokens
(`features/presentations/theme/tokens.css`) on top of these. The short brief for new screens is
[`../../../DESIGN.md`](../../../DESIGN.md).

## Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` (paper) | `#f6f6f3` | `#141413` | Page |
| `card` (sheet) | `#ffffff` | `#1b1b1a` | Panels, cards, alternating sections, popovers |
| `secondary` / `muted` (raised) | `#efeee9` | `#242422` | Raised fills, bar tracks |
| `accent` | `#ebeae4` | `#2a2a27` | Hover and selected backgrounds |
| `border` (rule) | `#e2e0d9` | `#31302d` | 1px dividers (`border-subtle` is one step quieter) |
| `input` | `#8c8981` | `#6d6b65` | Form-field boundary, at least 3:1 (WCAG 1.4.11) |
| `foreground` (ink) | `#171717` | `#f2f1ec` | Text |
| `muted-foreground` (graphite) | `#5c5a55` | `#a7a49c` | Secondary text (AA on every surface) |
| `faint` | `#85827b` | `#75726b` | Decoration and disabled only, not for reading |
| `primary` | `#cf460c` (hover `#b13a09`), white text | `#f97316` (hover `#fb8a3c`), `#1a0d04` text | The accent FILL: primary button, bars, selected state |
| `accent-ink` | `#b93d0b` | `#fb923c` | The accent as TEXT or icon (4.8:1 or better on paper, sheet and raised). Never `text-primary` on light |
| `brand` | `#ea580c` | `#f97316` | Display type (the hero's serif word) and the logo; large sizes only (3.3:1) |
| `destructive` | `#c81e1e` | `#ef4444` | Danger |
| `success` / `warning` / `info` | `#15803d` / `#a14a06` / `#1d4ed8` | `#22c55e` / `#f59e0b` / `#60a5fa` | Status |
| `ring` | `#b93d0b` | `#fb923c` | Focus outline and border |
| `chart-1..6` | ember, blue, green, violet, pink, cyan | the same hues, lighter | Categorical series, ember first, 3:1+ on white |

Compatibility: screens that were not redesigned still use `text-primary`; in light mode that class
(and its hover/focus/group/opacity variants) resolves to `accent-ink` through a shim at the end of
`globals.css`. New code writes `text-accent-ink`.

The theme default is light (`defaultTheme="light"` in `app/layout.tsx`, system preference still
available through the switch).

## Type

Inter Tight (`font-sans`, also `font-heading`) for UI and display. Instrument Serif italic (`font-serif`,
loaded in italic only) for one word per page, today the hero's "answer" in `text-brand`; nowhere else.
JetBrains Mono (`font-mono`) for join codes, ids, timers, counts and step numbers (always with
`tabular-nums`). Scale 12/14/16/18/20/24/30/36/48/56/72 and the hero's `clamp(3rem, 9vw, 6.75rem)`.
Body is 14-16. Headings are semibold; tracking tightens with size (`-0.02em` at 18-24, `-0.035em` at
30-36, `-0.04em` at 48-56, `-0.05em` for the hero). Nothing below 12px. No all-caps eyebrow labels, no
middle-dot meta strings, no arrows appended to button text.

## Radius, borders, elevation

`rounded-md` 6 (inputs, small buttons), `rounded-lg` 8 (app buttons, chips, menus), `rounded-xl` 12
(cards, dialogs, popovers), `rounded-2xl` 16 (large panels, the projected screen, plot panels),
`rounded-full` (marketing buttons and nav links, avatars). Borders are 1px `border-border`; a strong
rule (top of a list, the FAQ) is `border-foreground/15`. Shadows are soft, long and rare
(`0 32px 64px -24px` ink at 25-45%): the projected screen, the phone, the recommended pricing card,
illustration frames, dialogs.

## Spacing and layout

4px grid. Page gutters 16 / 24 / 32 (`px-4 sm:px-6 lg:px-8`), content width 1200 (`max-w-[1200px]`).
Landing sections use `py-20 md:py-28`, separated by a 1px top border; the steps section is the one
`card` (white sheet) band. Everything aligns to one left edge: section headers split on `lg` (h2 in 7
columns, the sentence in 5, bottom-aligned).

## Motion

150-250ms for UI transitions, `cubic-bezier(0.32, 0.72, 0, 1)` (`--ease-brand`) for larger moves. Nothing
delays a task. Motion shows results arriving, never decoration. Landing: one load-in for the hero and no
section reveals; product illustrations play once when half on screen and hold their last frame
(`features/landing/components/shared/motion.tsx`: `useSeen`, `useStepper`, `CountUp`, `ease`). Two things
loop: the hero's sample session and the question-types stage (autoplay every 6.5s while on screen, paused on
hover/focus, a pause button, stopped for good once a type is picked; the `.mk-progress` line is its timer).
`prefers-reduced-motion` stops all of it and shows settled frames (`.mk-surface` collapses animations and
transitions, `MotionConfig reducedMotion="user"` skips transforms, `html` drops smooth scrolling). Output whose
first frame depends on reduced motion renders after mount (`useMounted`), or hydration fails.

## Primitives (`components/ui`)

- `Button`: variants `default` (ember fill), `ink` (ink fill: a strong action that is not the screen's one accent
  action, like Present on a library card), `outline` (`border-foreground/15`), `secondary`, `ghost`, `destructive`,
  `link`; sizes `xs`, `sm`, `default` (36), `lg` (40), `touch` (44), `xl` (48), icon sizes. One `default` per screen.
  Links styled as buttons use `buttonVariants` (`linkButton` in `features/landing/components/shared/styles.ts`);
  marketing adds `pill` (`rounded-full`) from the same file.
- `Input`, `Textarea`: 6px radius, `border-input`, `bg-background`, focus = `border-ring` + 3px ring at 25%.
- `Card`: 12px, 1px border, no shadow. `Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`: 12 / 12 / 12 / 8 radius,
  border, soft shadow, scrim `black/60`.
- `Badge`: 12px label, variants `default`, `outline`, `accent`, `success`, `warning`, `danger`, `info`.
- `ProductLogo`: the Open Poll mark as inline SVG in `--brand` (also `public/logo-openpoll.svg` for the favicon).
- `ThemeSwitch` (`components/unlumen-ui`): a 36px ghost icon button (round on marketing pages).

Utilities kept for older screens, restyled flat: `bezel-outer`/`bezel-inner` (one bordered surface),
`bg-radial-glow` (a faint accent light), `skeleton`, `noise`, `animate-ai-glow`, `custom-scrollbar`, `scrollbar-none`.
Marketing and sign-in: `mk-focus`, `mk-skip-link`, `.mk-surface`, `.mk-grid` (40px graph paper fading toward
the bottom), `.mk-grid-flat` (the same grid without the fade, for `PlotPanel`, `ArtFrame` illustrations and the
sign-in aside) and `.mk-progress` (the stage's countdown line).

## Marketing and sign-in surfaces

See [`../features/landing-auth.md`](../features/landing-auth.md). Rules: copy states only what the product does;
product illustrations are labelled "Sample" and exposed as one image, and sit on graph paper (`PlotPanel`);
the projected stage is always dark (`<div className="dark ...">` re-applies the dark tokens inside a light
page, the recommended pricing card uses the same trick); the accent appears on one primary action, the lead
data series and small check/step marks.

## App screens

The creator shell and `/polls` follow these; other app screens still need their layout pass (settings, analytics,
the builders and the live surfaces re-skin through the tokens only).

- **Shell**: the sidebar is paper (`sidebar`), 14px nav items, the active one a white sheet with a ring and an
  ember icon; on phones a top bar opens it as a drawer (`core/routing-and-layouts.md`).
- **Page header**: left-aligned h1 at 36/48px (`tracking-[-0.04em]`) with one sentence under it, actions on the
  right; one `default` (ember) button per page.
- **Counts**: a hairline strip (`border-y`, `divide`), label above a 30/36px number, not a row of glowing cards.
- **Filters**: underline tabs (`border-b-2 border-foreground` when selected) with mono counts, then a 36px select
  and search on `bg-card` with `border-input`.
- **Cards**: 12px radius, 1px border, a graph-paper preview strip on top, the title as a stretched link, `outline`
  and `ink` actions. No uppercase micro-labels, nothing under 12px.

## Poll builder patterns (not yet migrated)

These screens still carry their older class names (amber/yellow tints, large radii, a few hard-coded
sandy glows). They render correctly on the new tokens; migrating them to the rules above is follow-up work.

### Layout shell
`/create` uses the **global app shell** (`Sidebar` + `main` from `GlobalClientLayout`). The poll builder content fills `main` with nested scroll (question rail + editor), not a separate full-viewport studio chrome.

### Two-Panel Layout
Inside `main`, the builder uses a side-by-side layout (question rail `w-40`–`xl:w-52` + editor `flex-1`):
- **Left panel**: Vertical question list. Each item is a compact row showing question number + truncated text. Selected item has amber ring. "Add question" at bottom and a small progress strip.
- **Right panel** (`flex-1`): Sticky route header (title + AI / done / publish) and scrollable question editor (`PollQuestionCard` stack).

### Phone-Frame Preview
The `LivePreview` component renders a phone-frame mockup:
```
Outer frame: rounded-[2.5rem] bg-[#1a1a1a] border-2 border-white/20 shadow-2xl
Screen: rounded-[2rem] bg-[#0a0a0a] overflow-hidden
```
Shows the current question as it will appear to respondents: question text, radio options, Submit button (disabled in preview).

### Settings Panel
Poll publish settings (title sync, expiry, anonymous, published) live in **`PublishSettingsModal`** when the user confirms publish. Optional in-page settings patterns may reuse `PollSettingsPanel` from `PollBasicsCard.tsx`.

### Response Mode Chip (PollCard)
```tsx
// Anonymous
<span class="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/50 border border-white/10">Anonymous</span>

// Authenticated
<span class="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 border border-amber-500/20">Auth Required</span>
```

### Expiry Countdown Badge
Shown on PollCard for active polls. Updates every minute using `setInterval`.
```
"Closes in 2h 14m"   → amber text
"Closed"             → muted text
```
