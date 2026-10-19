---
summary: Workspace selection (store, X-Workspace-Id, switcher), the /settings shell with its gated section nav, and how a package adds a settings page.
status: active
last_updated: 2026-10-19
---

# Workspaces and Settings

Everything lives in `features/workspaces/`. Backend contract: `backend/docs/wiki/modules/workspaces.md`.

## Files

| File | Role |
| --- | --- |
| `types.ts` | API shapes (`WorkspaceSummary`, `WorkspaceDetail`, `Entitlements`, `Capabilities`), `PLAN_NAMES`, `ROLE_NAMES`. |
| `api/workspaces.api.ts` | `listWorkspaces`, `createWorkspace`, `getWorkspace`, `updateWorkspace`, `switchWorkspace`, `getCapabilities`. |
| `store/selection.ts` | Pure logic: `WORKSPACE_HEADER`, `reconcileSelection`, `workspaceHeaderValue`, `pathAfterSwitch`. |
| `store/useWorkspaceStore.ts` | Zustand store. Persists only `{ userId, currentWorkspaceId }` (localStorage `openpoll_workspace`); the list and the current detail are refetched per page load. Must not import the API client. |
| `hooks/useWorkspaces.ts` | `useWorkspaces()` (list + selection, loads once), `useCurrentWorkspace()` (role, permissions, entitlements), `useCapabilities()`, `useSwitchWorkspace()`. |
| `components/WorkspaceSwitcher.tsx` | Sidebar header control (current workspace, switch, create team workspace, settings link). |
| `components/CreateWorkspaceDialog.tsx` | `POST /api/workspaces`; shows the plan-gate message as returned. |
| `components/SettingsNav.tsx` | The `/settings` nav. |
| `components/WorkspaceSettings.tsx` | `/settings/workspace` content: name (owners/admins), type, role, slug, plan limits and features, create team workspace. |
| `settings/sections.ts` | `SETTINGS_SECTIONS` registry and `resolveSection()`. |

## Selected workspace

- `lib/api-client.ts` sends `X-Workspace-Id: <currentWorkspaceId>` on every request, but only when the
  selection was made by the signed-in user (`workspaceHeaderValue`), and never overrides a header the
  caller set.
- On first load the selection is the server's `defaultWorkspaceId`. A persisted selection is kept while
  it is still in the list (`reconcileSelection`).
- `403 WORKSPACE_FORBIDDEN` on a request that carried the header (membership removed, workspace
  deleted): the client drops the selection, replays GET/HEAD once without it, and the next list load
  falls back to the default. Writes are not replayed.
- **Switching** calls `POST /api/workspaces/:id/switch` (the default also drives MCP tokens, AI
  generate-and-save and the next sign-in), selects it, then does a full navigation: settings pages
  reload in place, every other page goes to `/polls` (it may show the previous workspace's data).
  Pages therefore fetch in the workspace that was selected when they mounted; they need no
  workspace-change handling.
- Creating a team workspace switches to it.

## Settings shell

`app/(dashboard)/settings/layout.tsx` renders the title and `SettingsNav` beside the page. `/settings`
redirects to `SETTINGS_HOME` (`/settings/profile`). Pages render only their own sections:
`settings/profile` (profile, appearance, notifications, security), `settings/mcp`
(`McpSettingsSection`), `settings/workspace` (`WorkspaceSettings`), `settings/billing` (`BillingSettings`).

The nav lists **every** section in `SETTINGS_SECTIONS`, grouped Account / Workspace. Each entry is a
link when available, otherwise disabled with one line saying why. `resolveSection` checks, in order:

1. `capability` — `GET /api/capabilities` key the deployment must have (its own reason line).
2. `teamOnly` — personal workspaces don't have it.
3. `feature` — plan feature in the current workspace's entitlements ("Not included in the Free plan.").
4. `action` — permission from `GET /api/workspaces/:id` ("Requires the Admin role.").
5. `ready` — the page has shipped ("Coming soon.").

While capabilities or the workspace detail are loading, gated entries are disabled without a reason.

| Section | Gates | Ships in |
| --- | --- | --- |
| profile, mcp, workspace | none | W1-B |
| privacy | – | W4-C |
| members | team only | W3-B1 |
| audit | `workspace:manage` (admin) | W3-B1 |
| brand | `brand_kits`, `workspace:brand` (admin) | W3-A |
| billing | `workspace:billing` (owner); no capability gate: the page explains when billing is off (`features/billing.md`) | W3-C (shipped) |
| sso | capability `samlSso`, team only, `sso`, `workspace:sso` (admin) | W3-D |
| scim | capability `scim`, team only, `scim`, `workspace:sso` (admin) | W3-D |
| domains | capability `customDomains`, `custom_domains`, `workspace:domains` (admin) | W4-E |

### Adding a settings page (later packages)

1. Create `app/(dashboard)/settings/<id>/page.tsx` rendering only the page content (the layout adds the
   title and nav). Keep the page server-rendered and import a client component from your feature.
2. In `features/workspaces/settings/sections.ts`, set `ready: true` on your entry — a one-line change.
   Adjust its gates on the same entry if your package's rules differ.
3. Gate the page content itself too (a direct URL bypasses the nav): read `useCurrentWorkspace()` and
   `useCapabilities()`, and rely on the API's 403/503 for the real enforcement.

## Tests

`tests/unit/workspaces.store.test.ts` (selection logic, store actions, persistence) and
`tests/unit/settings.sections.test.ts` (registry and gate order). Run with `bun run test`.
