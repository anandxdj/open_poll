---
name: Open Poll Graph Paper 2.0
colors:
  background: '#f6f6f3' # paper
  foreground: '#171717' # ink
  card: '#ffffff' # sheet
  muted: '#efeee9'
  muted-foreground: '#5c5a55' # graphite
  border: '#e2e0d9' # rule
  primary: '#cf460c' # ember fill, white text 4.6:1
  accent-ink: '#b93d0b' # ember as text
  brand: '#ea580c' # display type and logo only
  dark-background: '#0d0d0c'
  dark-card: '#161615'
  dark-foreground: '#f2f1ec'
  dark-primary: '#f97316' # near-black text on it
typography:
  fontFamily: 'Inter Tight, ui-sans-serif, system-ui, sans-serif'
  serif: 'Instrument Serif (italic, one word per page)'
  mono: 'JetBrains Mono (codes, counts, numbers)'
  headings:
    fontWeight: '600'
    letterSpacing: '-0.02em at 24px, -0.04em at 36-56px, -0.05em at 60px and up'
  body:
    fontSize: '16px'
    lineHeight: '1.6'
rounded:
  md: '10px' # fields
  lg: '12px' # menus, chips, nav items
  xl: '16px' # cards
  2xl: '20px' # dialogs, panels
  full: '9999px' # every button
---

# Design system: Graph paper

Open Poll is where a room answers a question and the answers get plotted. The
visual language borrows from that: warm paper, ink, hairline graph-paper grids,
and one ember-orange mark for the thing that matters (the leading answer, the
primary action). Light-first, with a complete near-black graphite dark mode.
Version 2.0 (2026-10-30, after sumanlabs.in) made buttons pills everywhere,
moved the radius scale up, deepened dark mode and added mono `meta-label`s.

Tokens live in `app/globals.css`; the full rules and component notes are in
`docs/wiki/ui/design-system.md`. This file is the short brief for anyone (or
any coding agent) starting a new screen.

## Principles

1. **Ink acts, ember signals.** Text and structure are ink on paper. Ember marks
   the one primary action on a screen, the leading data series, checks and
   selected states. Never decorate with it.
2. **Plot, don't float.** Product illustrations sit on graph paper (`PlotPanel`,
   `.mk-grid`) instead of floating in gradient space. Shadows are soft, long and
   rare: the projected screen, the phone, a dialog.
3. **Type carries the voice.** Inter Tight 600 with tight tracking for headings.
   One Instrument Serif italic word per page (the hero's "answer"); nowhere else.
   JetBrains Mono for data (join codes, counts, percentages, step numbers) and
   for `meta-label`s: a date or small fact beside a heading, in mono caps.
4. **Left axis.** Headings, copy and CTAs align to one left edge. Section
   headers split on wide screens: h2 left, one sentence right.
5. **Say what it does.** Sentence case, plain verbs, only claims the product
   backs. No eyebrow over every heading, no middle-dot meta strings, no arrows
   appended to button text.

## Colour

| Role | Light | Dark |
| --- | --- | --- |
| Page (paper) | `#f6f6f3` | `#0d0d0c` |
| Sheet (cards, popovers) | `#ffffff` | `#161615` |
| Raised fill | `#efeee9` | `#1f1f1d` |
| Rule (borders) | `#e2e0d9` | `#2b2a27` |
| Ink (text) | `#171717` | `#f2f1ec` |
| Graphite (secondary text) | `#5c5a55` | `#a7a49c` |
| Ember fill (`primary`) | `#cf460c`, white text | `#f97316`, `#1a0d04` text |
| Ember text (`accent-ink`) | `#b93d0b` | `#fb923c` |
| Brand (display, logo) | `#ea580c` | `#f97316` |

Sample sessions in marketing and sign-in follow the app theme, answers shown
as `ResultRow` cards on graph paper. The real projected stage is always dark
(warm graphite, `--deck-*` tokens); where a small picture of it appears inside
a light page (library cards, slide thumbnails), wrap it in
`<div className="dark ...">` to re-apply the dark tokens.

## Shape

Every button is a pill (`rounded-full`), in the app and on marketing pages.
Fields 10px, menus and chips 12px, cards 16px, dialogs and large panels 20px.
Borders are 1px rules; a list is hairline rows, a feature grid is one bordered
block with `gap-px` dividers.

## App screens

Paper sidebar listing places only (Home, Library, Analytics, then Members and
Settings), white-sheet active item; Home at `/home` is where creators land;
page header with a 48px h1 and actions on the right; counts as a hairline strip; underline tabs; cards with a
graph-paper preview on top and the title as a stretched link. Card actions are
`outline` and `ink` buttons; ember is kept for the page's one main action and
for things that are live. Phones get a top bar and a drawer.

## Motion

Motion shows results arriving; it never decorates. 150-250ms UI transitions on
`cubic-bezier(0.32, 0.72, 0, 1)`.

- One load-in on the hero. No fade-and-slide-up on sections.
- Illustrations play once, the first time they are half on screen, then hold
  their last frame (`useStepper`, `CountUp` in
  `features/landing/components/shared/motion.tsx`).
- Only two things loop: the hero's sample session and the question-types
  stage, which moves to the next slide type every 6.5s while on screen. It
  pauses on hover and focus, has a pause button, and stops for good once
  someone picks a type.
- `prefers-reduced-motion`: no autoplay, every illustration shows its
  settled frame. Anything whose first frame depends on that setting renders
  after mount, so server and client HTML agree.
