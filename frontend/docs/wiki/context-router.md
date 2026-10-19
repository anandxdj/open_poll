# Frontend Context Router

**STRICT RULE**: Do NOT read all wiki files at once. This causes context pollution.
**Load only one task branch at a time.** You must ONLY read the specific files that govern the domain of your current task. Add more docs ONLY if you are blocked by missing context.

Before generating any code, identify your task type and read the corresponding spec:

## 1. Project Management & Milestones

- **Task**: Checking what the project is about, goals, and agenda.
- **Action**: Read `frontend/docs/wiki/project-context.md`
- **Task**: Checking current progress, what is done, or next steps.
- **Action**: Read `frontend/docs/wiki/processes/execution-log.md` and `frontend/docs/wiki/features/feature-tracker.md`

## 2. UI & Styling

- **Task**: Styling layout shells, applying global themes, Double-Bezel CSS.
- **Action**: Read `frontend/docs/wiki/ui/design-system.md`
- **Task**: Building reusable UI components, shadcn/ui modifications.
- **Action**: Read `frontend/docs/wiki/ui/components.md`

## 3. Next.js Core Architecture

- **Task**: Creating new pages, layouts, dealing with Kinetic Sidebar or server/client component boundaries.
- **Action**: Read `frontend/docs/wiki/core/routing-and-layouts.md`
- **Task**: Managing local storage, device IDs, or global state.
- **Action**: Read `frontend/docs/wiki/core/state.md`

- **Task**: Changing the deck builder, slide editors, slide types, or inspector tabs.
- **Action**: Read `frontend/docs/wiki/features/presentation-builder.md`
- **Task**: Changing AI whole-deck generation in the builder (the AI dialog's "Whole deck" mode, outline review, mock-mode labelling, `features/ai/deck/`).
- **Action**: Read `frontend/docs/wiki/features/ai-deck.md`
- **Task**: Changing the live host console, participant view, stage, slide runtime views, the live store/slots, deck theme tokens, or live i18n.
- **Action**: Read `frontend/docs/wiki/features/live-surfaces.md`

- **Task**: Workspaces (switcher, selected workspace, `X-Workspace-Id`) or any `/settings` page or section.
- **Action**: Read `frontend/docs/wiki/features/workspaces.md`

- **Task**: Changing the library at `/polls` (poll + deck cards, filters, convert to presentation).
- **Action**: Read `frontend/docs/wiki/features/library.md`

- **Task**: Session history, the session report, exports, public results links (`/r/[token]`), the participant results page (`/live/[code]/summary`) or the end-screen links to them.
- **Action**: Read `frontend/docs/wiki/features/sessions.md`

## 4. API & Data

- **Task**: Writing fetch calls, React Query hooks, or API integrations.
- **Action**: Read `frontend/docs/wiki/data/fetching.md`
- **Task**: Working with WebSockets, live updates, or socket.io logic.
- **Action**: Read `frontend/docs/wiki/data/realtime.md`

## 5. Testing & Components

- **Task**: Checking the `/test` dashboard layout, or isolated component tests.
- **Action**: Read `frontend/docs/wiki/testing/app-test-page.md`
- **Task**: Running or writing Playwright end-to-end tests (`e2e/**`).
- **Action**: Read `frontend/docs/wiki/testing/e2e.md`

Remember: **Spec-Driven Development** means no assumptions. Check the spec first.
