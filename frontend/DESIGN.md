---
name: Open Poll Premium
colors:
  surface: '#050505'
  surface-dim: '#0a0a0a'
  surface-bright: '#1a1a1a'
  on-surface: '#ffffff'
  primary: '#facc15'
  on-primary: '#000000'
  primary-container: '#facc15'
  on-primary-container: '#000000'
  secondary: '#f97316'
  on-secondary: '#ffffff'
  outline: 'rgba(255, 255, 255, 0.1)'
typography:
  fontFamily: 'Geist, sans-serif'
  h1:
    fontSize: 36px
    fontWeight: '700'
    letterSpacing: '-0.02em'
  body:
    fontSize: 16px
    fontWeight: '400'
rounded:
  default: '1rem'
  xl: '1.5rem'
  '2xl': '2rem'
---

# Design System: Open Poll Premium

## Creative North Star: "The Cinematic Creator"
This design system is built for creators who value precision and premium aesthetics. We use **Vantablack surfaces**, **Glowing Yellow accents**, and **Double-Bezel architecture** to create an interface that feels like high-end hardware.

## Core Principles

### 1. The Double-Bezel (Nested Architecture)
Major containers should never sit flat. Use a nested wrapper for haptic depth.
- **Outer Shell**: `p-1.5 rounded-[2rem] bg-white/5 border border-white/10`
- **Inner Core**: `rounded-[calc(2rem-0.375rem)] bg-[#0a0a0a] shadow-inner`

### 2. Button-in-Button
Primary CTAs should include a nested circular icon wrapper to create kinetic tension.

### 3. Macro-Whitespace
Allow the design to breathe. Use `py-24` or higher for section gaps and `p-8` for container internals.

### 4. Fluid Motion
All transitions must use custom cubic-beziers: `cubic-bezier(0.32, 0.72, 0, 1)`.
