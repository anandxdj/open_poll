---
summary: Next.js App Router rules, island architecture, and folder boundaries.
status: active
last_updated: 2026-05-13
---

# Routing & Layouts

The frontend follows a feature-driven, Server-Component-first architecture using the Next.js App Router.

## Folder Responsibilities

- `app/` owns file-based routing, server layouts, pages, and route handlers.
- `components/ui/` owns purely presentational, reusable UI primitives (shadcn).
- `components/layouts/` owns shell wrappers (Navbar, Kinetic Sidebar).
- `features/` owns domain-specific logic (`polls`, `analytics`, `responses`). Features encapsulate their own `api/`, `components/`, and `hooks/`.

## Rendering Flow & Island Architecture

- **Server by Default**: All components are React Server Components (RSC) unless explicitly marked with `"use client"`.
- **Island Architecture**: Do not wrap entire pages in `"use client"`. Pass server-fetched data as props down to purely interactive leaf nodes (the "islands").
- **Data Flow**: `Server Page (fetches payload)` -> `Props` -> `Client Component (handles user input / sockets)`.

## Core Layout Patterns

- **Kinetic Sidebar**: Resides in `app/(dashboard)/layout.tsx`. Does not re-render on nested page navigation.
- **Double-Bezel Shell**: Pages define the inner content padding, while the layouts define the rounded outer containment shell (`rounded-2xl`).
