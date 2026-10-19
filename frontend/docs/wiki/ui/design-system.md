---
summary: The Open Poll design foundation (tokens, type, radius, spacing, motion, primitives) and the rules for marketing and sign-in surfaces.
status: active
last_updated: 2026-10-19
---

# Design system

Dark-first with a complete light mode, one yellow accent, Geist. Restrained and precise: borders first,
shadows soft and rare, no decorative glow. The tokens live in `app/globals.css` (`@theme inline` plus
`:root` and `.dark`); components read tokens, never raw hex. Live surfaces layer their `--deck-*`
tokens (`features/presentations/theme/tokens.css`) on top of these.

## Colour

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `background` | `#09090b` | `#ffffff` | Page |
| `card` (surface) | `#111113` | `#fafafa` | Panels, cards, alternating sections |
| `secondary` / `muted` (raised) | `#18181b` | `#f4f4f5` | Raised fills, bar tracks, hover |
| `accent` | `#1f1f23` | `#f4f4f5` | Hover and selected backgrounds |
| `border` | `#27272a` | `#e4e4e7` | 1px dividers (`border-subtle` is one step quieter) |
| `input` | `#62626b` | `#8f8f98` | Form-field boundary, at least 3:1 (WCAG 1.4.11) |
| `foreground` | `#fafafa` | `#09090b` | Text |
| `muted-foreground` | `#a1a1aa` | `#52525b` | Secondary text (AA on every surface) |
| `faint` | `#71717a` | `#71717a` | Decoration and disabled only, not for reading |
| `primary` | `#facc15` (hover `#eab308`) | `#eab308` (hover `#ca8a04`) | The accent FILL: primary button, bars, selected state; text on it is `primary-foreground` `#0a0a0a` |
| `accent-ink` | `#facc15` | `#a16207` | The accent as TEXT or icon (4.9:1 on white). Never `text-primary` on light |
| `destructive` | `#ef4444` | `#dc2626` | Danger (light is the AA-safe red for text) |
| `success` / `warning` / `info` | `#22c55e` / `#f59e0b` / `#3b82f6` | `#15803d` / `#b45309` / `#1d4ed8` | Status |
| `ring` | `#facc15` | `#a16207` | Focus outline and border |
| `chart-1..6` | yellow, blue, green, violet, pink, orange | the same hues, 3:1+ on white | Categorical series, yellow first |

Compatibility: screens that were not redesigned still use `text-primary`; in light mode that class
(and its hover/focus/group/opacity variants) resolves to `accent-ink` through a shim at the end of
`globals.css`. New code writes `text-accent-ink`.

## Type

Geist Sans (`font-sans`) for UI, Geist Mono (`font-mono`) for join codes, ids, timers and numbers (always with
`tabular-nums`). Scale 12/14/16/18/20/24/30/36/48/60/72 (Tailwind `text-xs` to `text-7xl`). Body is 14-16.
Headings are semibold; tracking tightens only from the display sizes (`-0.02em` at 24, `-0.03em` at 36-48,
`-0.045em` at 60-72). Nothing below 12px. No all-caps eyebrow labels.

## Radius, borders, elevation

`rounded-md` 6 (inputs, small buttons), `rounded-lg` 8 (buttons, chips, menus), `rounded-xl` 12 (cards,
dialogs, popovers), `rounded-2xl` 16 (large panels, the hero stage), `rounded-full` (pills, avatars).
Borders are 1px `border-border`. Shadows are soft and rare: dialogs and floating product illustrations only.

## Spacing and layout

4px grid. Page gutters 16 / 24 / 32 (`px-4 sm:px-6 lg:px-8`), content width 1200 (`max-w-[1200px]`).
Landing sections use `py-20 md:py-28`, separated by a 1px top border and alternating `background` / `card`.

## Motion

150-250ms for UI transitions, `cubic-bezier(0.32, 0.72, 0, 1)` (`--ease-brand`) for larger moves. Nothing
delays a task. Landing: one load-in for the hero, no scroll-triggered reveals; the sample session is the only
looping motion. `prefers-reduced-motion` stops it (`.mk-surface` collapses animations and transitions,
`MotionConfig reducedMotion="user"` skips transforms, `html` drops smooth scrolling).

## Primitives (`components/ui`)

- `Button`: variants `default` (yellow fill), `outline` (`border-foreground/15`), `secondary`, `ghost`, `destructive`,
  `link`; sizes `xs`, `sm`, `default` (36), `lg` (40), `touch` (44), `xl` (48), icon sizes. One `default` per screen.
  Links styled as buttons use `buttonVariants` (`linkButton` in `features/landing/components/shared/styles.ts`).
- `Input`, `Textarea`: 6px radius, `border-input`, `bg-background`, focus = `border-ring` + 3px ring at 25%.
- `Card`: 12px, 1px border, no shadow. `Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`: 12 / 12 / 12 / 8 radius,
  border, soft shadow, scrim `black/60`.
- `Badge`: 12px label, variants `default`, `outline`, `accent`, `success`, `warning`, `danger`, `info`.
- `ProductLogo`: the Open Poll mark as inline SVG in `--primary` (also `public/logo-openpoll.svg` for the favicon).
- `ThemeSwitch` (`components/unlumen-ui`): a 36px ghost icon button.

Utilities kept for older screens, restyled flat: `bezel-outer`/`bezel-inner` (one bordered surface),
`bg-radial-glow` (a faint accent light), `skeleton`, `noise`, `animate-ai-glow`, `custom-scrollbar`, `scrollbar-none`.
New: `mk-focus`, `mk-skip-link`, `mk-grid`, `.mk-surface` (marketing and sign-in pages).

## Marketing and sign-in surfaces

See [`../features/landing-auth.md`](../features/landing-auth.md). Rules: copy states only what the product does;
product illustrations are labelled "Sample" and exposed as one image; the projected stage is always dark
(`<div className="dark ...">` re-applies the dark tokens inside a light page); the accent appears on one primary
action, the lead data series and small check/step marks.

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

## Marketing and auth surfaces (landing, sign-in, Privacy/Terms)

The rendered app is warm near-black / off-white with **Sandy Tan `#d8ad87`** as the accent and
**Amethysta** as the typeface (`app/globals.css`, `app/layout.tsx`); the yellow `#facc15` and Geist
described above are the original direction and are no longer what the shared theme renders. These
surfaces follow the theme as it is. Feature wiki: [`../features/landing-auth.md`](../features/landing-auth.md).

**Tokens added to `globals.css`** (additive):

| Token / class | Use |
| --- | --- |
| `--brand-ink` / `text-brand-ink` | Brand-coloured text and icons. Dark: `#d8ad87`. Light: `hsl(28 62% 33%)` (5.9:1 on the off-white; `#d8ad87` itself is about 1.9:1 there, so never use `text-primary` for text on light). |
| `--field-border` / `border-field-border` | Input boundary with at least 3:1 against page and card in both themes (WCAG 1.4.11). |
| `mk-focus` | Keyboard focus outline in `brand-ink`; use on links and custom controls. |
| `mk-skip-link` | Off-screen "Skip to content" link, visible on focus. |
| `mk-dot-grid` | Hero dot grid, masked toward the edges. |
| `.mk-surface` | Marks a page that honours `prefers-reduced-motion` (animations and transitions collapse to ~0). `html` also drops smooth scrolling for reduced motion. |

**Scales** (landing; `features/landing/components/shared/styles.ts`):

- Gutters `px-5 sm:px-6 lg:px-8`, max width `max-w-7xl`. Section rhythm `py-20 sm:py-24 lg:py-28`.
- Type: h1 48/60 (hero), h2 30/36/48 (`SectionHeading`), h3 20-24, body 16/18, labels and hints 14.
  Nothing below 12px, no all-caps eyebrow labels, no text-opacity tricks (`/50`) for readable copy.
- Buttons: `button.primary|secondary` 44px, `*Lg` 48px, `rounded-2xl`, ease `cubic-bezier(0.32,0.72,0,1)`.
  Touch targets are at least 44px (menu toggle, links in lists, FAQ rows, form fields).
- Cards: double bezel (`p-1.5` outer, inner radius `calc(2rem - 0.375rem)`); a feature grid is one
  bezel with hairline dividers (`gap-px bg-border`) instead of a row of separate cards.
- Motion: one page-load reveal in the hero, one reveal per showcase row; the live preview is the only
  looping motion and stops for reduced motion. `MotionConfig reducedMotion="user"` on the landing and auth shell.
- Copy: sentence case, plain verbs, only claims the product backs (see the feature wiki).
