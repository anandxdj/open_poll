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
