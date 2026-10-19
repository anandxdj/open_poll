---
summary: Global aesthetic rules, Tailwind constraints, Double-Bezel logic, and Poll Builder UI patterns.
status: active
last_updated: 2026-05-13
---

# Design System & Aesthetics

## Core Aesthetic: "The Cinematic Creator"

We use a high-end, agency-tier aesthetic. Surfaces are Vantablack (`#050505`), accents are Glowing Yellow (`#facc15`), and the interface uses Double-Bezel nested architecture for depth.

- **Theme Control**: Icon-only (centered in sidebar) per product feedback.
- **Navbar**: Copy is route-scoped; sidebar holds the product name once. (No duplicate "Open Polls" line).
- **Font**: Geist (or system sans fallback). Tracking: tight on headings, widest on uppercase labels.

## Double-Bezel System

The Double-Bezel is a nested container architecture that creates visual depth like premium hardware.

```html
<!-- Outer shell -->
<div class="p-1.5 rounded-[2rem] bg-white/5 border border-white/10">
  <!-- Inner core -->
  <div class="rounded-[calc(2rem-0.375rem)] bg-[#0a0a0a] shadow-[inset_0_4px_20px_rgba(0,0,0,0.8)]">
    <!-- Content -->
  </div>
</div>
```

- Ensure layout shell uses this architecture.
- Cards (`card.tsx`, etc.) must strictly use `rounded-2xl`.
- Active state on question cards: add `ring-1 ring-yellow-400/30` to outer shell.

## Shapes & Radii

- **Inputs & Controls**: `rounded-2xl` or pill-shaped (e.g., `rounded-full` for CTA buttons).
- **CTA / Buttons**: Yellow CTAs use `bg-yellow-400 text-black rounded-2xl` or `rounded-full` for pill buttons.
- **Sidebar**: Single brand block, nav items with `rounded-2xl`, profile wrapper `rounded-2xl`.
- **Question cards**: `rounded-[2rem]` outer, `rounded-[calc(2rem-0.375rem)]` inner.

## Motion System

All transitions must use: `cubic-bezier(0.32, 0.72, 0, 1)`.

- Duration: `duration-500` for most interactions, `duration-700` for layout shifts.
- Page entry: `animate-in fade-in slide-in-from-bottom-8 duration-700`.
- Active nav indicator: Framer Motion `layoutId="activeNav"` spring transition.
- Icon rotations (chevrons, theme toggle): `transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]`.

## Color Tokens

| Token | Value | Usage |
|---|---|---|
| `surface` | `#050505` | Root background |
| `surface-dim` | `#0a0a0a` | Inner bezel, card backgrounds |
| `surface-bright` | `#1a1a1a` | Hover states, elevated surfaces |
| `primary` | `#facc15` | Yellow accent, CTAs, active states |
| `on-primary` | `#000000` | Text on yellow |
| `secondary` | `#f97316` | Orange accent, bar charts, icons |
| `outline` | `rgba(255,255,255,0.1)` | Borders, dividers |

## Poll Builder UI Patterns

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
