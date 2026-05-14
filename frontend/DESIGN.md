---
name: Open Poll Modern
colors:
  background: 'hsl(0 0% 100%)'
  foreground: 'hsl(222.2 84% 4.9%)'
  primary: 'hsl(28 50% 69%)' # #d8ad87 Sandy Tan
  secondary: 'hsl(210 40% 96.1%)'
  muted: 'hsl(210 40% 96.1%)'
  border: 'hsl(214.3 31.8% 91.4%)'
typography:
  fontFamily: 'Geist Sans, Inter, sans-serif'
  headings:
    fontWeight: '700'
    letterSpacing: '-0.025em'
  body:
    fontSize: '16px'
    lineHeight: '1.6'
rounded:
  default: '0.5rem'
  md: '0.375rem'
  lg: '0.5rem'
  xl: '0.75rem'
---

# Design System: Open Poll Modern (Supastarter Inspired)

## Creative North Star: "Professional Clarity"
This design system is inspired by **supastarter.dev**, focusing on a clean, high-contrast, and professional SaaS aesthetic. It prioritizes readability, functional components, and a "production-ready" feel.

## Core Principles

### 1. High Contrast & Readability
Use deep slates for text and pure whites/light slates for backgrounds. Ensure every element has sufficient contrast for accessibility.

### 2. Standardized Component Geometry
Stick to standard Tailwind radii (0.5rem) and spacing (4px/0.25rem grid). Avoid over-styling with glows or complex gradients.

### 3. Functional Motion
Transitions should be subtle and fast. Use standard easing for UI interactions to maintain a responsive feel.

### 4. Semantic Color Usage
- **Primary (#d8ad87 Sandy Tan)**: Call to actions, active states, and focus rings.
- **Secondary/Muted (warm sand)**: Backgrounds for cards, sidebars, and inactive elements.
- **Destructive (Red)**: Error states and dangerous actions.

## Component Guidelines

### Buttons
- **Primary**: Solid Blue, white text.
- **Secondary**: Light Gray background or outlined.
- **Ghost**: Transparent, subtle background on hover.

### Cards
- Bordered by default (`border-border`).
- Subtle shadows or flat depending on context.
- Consistent padding (`p-6`).

### Typography
- **Headings**: `tracking-tight font-bold`.
- **Body**: `leading-relaxed text-muted-foreground` for secondary info, `text-foreground` for primary content.
