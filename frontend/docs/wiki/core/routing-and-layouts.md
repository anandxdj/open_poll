---
summary: Next.js App Router rules, island architecture, and folder boundaries.
status: active
last_updated: 2026-10-30
---

# Routing & Layouts

The frontend follows a feature-driven, Server-Component-first architecture using the Next.js App Router.

## Folder Responsibilities

- `app/` owns file-based routing, server layouts, pages, and route handlers.
- `components/ui/` owns purely presentational, reusable UI primitives (shadcn).
- `components/layouts/` owns shell wrappers (DashboardShell, Kinetic Sidebar).
- `features/` owns domain-specific logic (`polls`, `analytics`, `responses`). Features encapsulate their own `api/`, `components/`, and `hooks/`.

## Rendering Flow & Island Architecture

- **Server by Default**: All components are React Server Components (RSC) unless explicitly marked with `"use client"`.
- **Island Architecture**: Do not wrap entire pages in `"use client"`. Pass server-fetched data as props down to purely interactive leaf nodes (the "islands").
- **Data Flow**: `Server Page (fetches payload)` -> `Props` -> `Client Component (handles user input / sockets)`.

## Core Layout Patterns

- **Kinetic Sidebar**: Resides in `app/(dashboard)/layout.tsx` (via `components/layouts/DashboardShell.tsx`, which also mounts the create-poll and create-deck modal providers). `components/layouts/Sidebar.tsx` renders one `SidebarContent` (brand, workspace switcher, the places from `components/layouts/nav.ts`: Home / Library / Analytics, then Members / Settings under "Workspace", and the account menu) in two places: the desktop rail (`md` and up, 248px, collapses to 64px) and, below `md`, a drawer opened from `MobileTopBar` (a Radix Dialog: focus trapped, Escape and the scrim close it, a choice closes it). Does not re-render on nested page navigation. A page gets the sidebar only by living in `(dashboard)`; landing, auth, `/live`, `/p/[id]`, `/presentation/host`, `/privacy`, `/terms` and `/test` sit outside it and render without chrome. `components/layouts/GlobalClientLayout.tsx` (root layout) only restores the session.
- **Double-Bezel Shell**: Pages define the inner content padding, while the layouts define the rounded outer containment shell (`rounded-2xl`).
- **Home**: `/home` (`HOME_PATH` in `lib/routes.ts`) is where a creator lands: after sign-in (`LoginForm`, `/auth/complete`), from the logo, after switching workspace (`pathAfterSwitch`) and from the landing page's dashboard links. See `features/home.md`.
- **Settings**: `app/(dashboard)/settings/layout.tsx` owns the title and the section nav; each section is its own page at `/settings/<id>` and `/settings` redirects to `/settings/profile`. Adding a section: `frontend/docs/wiki/features/workspaces.md`.

## Proxy and Security Headers

- **Proxy** (Next 16 renamed `middleware.ts` to `proxy.ts`): `proxy.ts` only holds the `matcher` (it must stay a literal) and calls `runProxyChain` from `lib/proxy/index.ts`. The chain is an ordered list of `ProxyStep`s; the first step that returns a response wins, otherwise the request continues. Steps live one per file (`lib/proxy/domains.ts` first: a workspace's custom domain serves only the participant side, see `features/workspaces.md`; `lib/proxy/auth.ts`: signed-out visitors on `/home`, `/polls`, `/create`, `/settings`, `/analytics` go to `/login`; a signed-in visitor on `/login`/`/signup` goes to `/home`). Add a step with one line in `PROXY_CHAIN`.
- **Headers**: `lib/security/headers.ts` builds the baseline applied to every path by `next.config.ts` `headers()`: `Content-Security-Policy: frame-ancestors 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. CSP directives are a map (`CSP_DIRECTIVES`), one line per directive; only listed directives are enforced.
