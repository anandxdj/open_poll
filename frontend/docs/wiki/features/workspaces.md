---
summary: Workspace selection (store, X-Workspace-Id, switcher), the /settings shell with its gated section nav, members, invitations, the ShareDialog, the audit log, and how a package adds a settings page.
status: active
last_updated: 2026-10-25
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
| `settings/retention.ts` | Data retention choices for `/settings/workspace` (`retentionOptions`, `retentionText`), capped by the plan's `retentionDays`. |
| `settings/blocks.tsx` | What every settings page is built from (also billing and MCP): `settingsCard` (white sheet), `settingsList` (sheet of hairline rows), `SettingsHeading`, `SettingsRow` (label and help left, control right, stacked on phones), `SettingsLoading`, `SettingsFailed`. |

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

`app/(dashboard)/settings/layout.tsx` renders the title and `SettingsNav` beside the page (`lg`; above it
on smaller screens, as one scrolling row of chips whose disabled reasons are read to assistive tech only).
`/settings` redirects to `SETTINGS_HOME` (`/settings/profile`). Pages render only their own sections:
`settings/profile` (profile: name and email read-only, there is no update API; appearance: Light / Dark /
System; security: "Reset password" links to `/forgot-password`, the only password flow the API has. The
old notification switches and "Change password" button did nothing and were removed), `settings/mcp`
(`McpSettingsSection`), `settings/privacy` (`PrivacySettings`, below), `settings/workspace` (`WorkspaceSettings`:
name, plan, **data retention** for owners and admins (`#retention`, `PATCH settings.retentionDays`; applies to
sessions that end afterwards), team workspaces), `settings/billing` (`BillingSettings`).

The nav lists **every** section in `SETTINGS_SECTIONS`, grouped Account / Workspace. Each entry is a
link when available, otherwise disabled with one line saying why. `resolveSection` checks, in order:

1. `capability` — `GET /api/capabilities` key the deployment must have (its own reason line).
2. `teamOnly` — personal workspaces don't have it (`TEAM_ONLY_REASON`). From `lg` the first such entry gets a
   "Create a team workspace" button under its reason that opens `CreateWorkspaceDialog` and switches to the new one.
3. `feature` — plan feature in the current workspace's entitlements ("Not included in the Free plan.").
4. `action` — permission from `GET /api/workspaces/:id` ("Requires the Admin role.").
5. `ready` — the page has shipped ("Coming soon.").

While capabilities or the workspace detail are loading, gated entries are disabled without a reason.

| Section | Gates | Ships in |
| --- | --- | --- |
| profile, mcp, workspace | none | W1-B |
| privacy | none (the user's own account) | W4-C (shipped) |
| members | team only (every member sees the roster; managers get the controls) | W3-B1 |
| audit | `workspace:manage` (admin) | W3-B1 |
| brand | `brand_kits`, `workspace:brand` (admin) | W3-A (shipped) |
| billing | `workspace:billing` (owner); no capability gate: the page explains when billing is off (`features/billing.md`) | W3-C (shipped) |
| sso | capability `samlSso`, team only, `sso`, `workspace:sso` (admin) | W3-D (shipped) |
| scim | capability `scim`, team only, `scim`, `workspace:sso` (admin) | W3-D (shipped) |
| domains | capability `customDomains`, `custom_domains`, `workspace:domains` (admin) | W4-E (shipped) |

### Adding a settings page (later packages)

1. Create `app/(dashboard)/settings/<id>/page.tsx` rendering only the page content (the layout adds the
   title and nav). Keep the page server-rendered and import a client component from your feature.
2. In `features/workspaces/settings/sections.ts`, set `ready: true` on your entry — a one-line change.
   Adjust its gates on the same entry if your package's rules differ.
3. Gate the page content itself too (a direct URL bypasses the nav): read `useCurrentWorkspace()` and
   `useCapabilities()`, and rely on the API's 403/503 for the real enforcement.

## Brand (W3-A)

`features/themes/`, page `settings/brand` (`BrandSettings`). Backend contract: `backend/docs/wiki/modules/themes.md`.

| Path (`features/themes/…`) | Role |
| --- | --- |
| `types.ts`, `api/themes.api.ts` | `ThemeTokens`, `BrandKit`, `DeckThemeRef`; presets, brand kit CRUD, `saveDeckTheme`. |
| `contrast.ts`, `fonts.ts` | Mirrors of the API's WCAG checks and font URLs, for live feedback and previews of unsaved kits. |
| `deckTheme.ts` | `deckThemeFrom(tokens)`: a session's snapshot as a `DeckTheme` (see `live-surfaces.md`). |
| `hooks/useThemeCatalog.ts` | Presets, fonts and (when the plan has them) the workspace's kits. |
| `components/BrandSettings.tsx` | Kit cards (swatch, fonts, edit, delete with confirmation), the "Theme for new decks" select (`settings.defaultTheme`), the editor. Members without `workspace:brand` or plans without `brand_kits` get one line saying why. |
| `components/BrandKitEditor.tsx` | Name, eight colours (picker plus hex field), contrast checks as you type (saving waits until all pass), chart colours (1–12), heading and body fonts, logo and stage background (upload with `brand_logo` / `brand_background` when storage is on, or a link), background overlay. |
| `components/BrandPreview.tsx`, `ThemeSwatch.tsx` | A stage and a phone drawn with the real deck tokens; a small swatch for lists. |
| `components/ThemeTab.tsx` | The builder's deck-level Theme tab (`presentation-builder.md`). |

## Custom domains and white-label (W4-E)

`features/domains/`, page `settings/domains` (`DomainsSettings`). Backend contract:
`backend/docs/wiki/modules/domains.md`; operator setup: `docs/deploy/custom-domains.md`.

| Path | Role |
| --- | --- |
| `features/domains/components/DomainsSettings.tsx` | Add a hostname, its CNAME and TXT records to copy with found/missing, Check DNS, status (Waiting for DNS, Live, Needs attention), Open, remove. Same gate reasons as the nav. |
| `features/domains/hosts.ts` | `customDomainsOn()` (`NEXT_PUBLIC_CUSTOM_DOMAINS=on`), `isPrimaryHost` (site URL, `NEXT_PUBLIC_PRIMARY_HOSTS`, local and `*.vercel.app`), `customDomainAction(pathname)`: `/` join, participant paths and assets pass, the rest redirects. |
| `lib/proxy/domains.ts` | First step of `PROXY_CHAIN`: on a custom host, asks `GET /api/public/domains/resolve` (cached a minute per host); unknown hosts go to the main site (307), `/` is rewritten to `/live`, other paths move to the main site (308). |
| `features/domains/hooks/useCustomDomain.ts` | On a custom domain, the resolved workspace: the join page (`app/live/page.tsx`) shows its name, brand kit logo and colours. |
| `features/branding/PoweredBy.tsx` | The "Made with Open Poll" footer of `PublicPageShell`, hidden on a white-label workspace's domain. |
| `features/workspaces/settings/CopyValue.tsx` | Label, monospace value and copy button, shared by the SSO, SCIM and domains pages. |

## Single sign-on and SCIM (W3-D)

`features/sso/`, pages `settings/sso` (`SsoSettings`) and `settings/scim` (`ScimSettings`). Backend
contract: `backend/docs/wiki/modules/sso-scim.md`; operator setup: `docs/deploy/sso.md`.

| Path (`features/sso/…`) | Role |
| --- | --- |
| `types.ts`, `api/sso.api.ts` | Connections, domains, metadata import, test link, SCIM tokens, `discoverSso(email)`. |
| `components/SsoSettings.tsx` | `useSsoGate` (capability, team, plan, role, the same reasons as the nav), "Require single sign-on" (off until a connection is on with a verified domain and a passed test; the owner keeps password sign-in), connection cards, a new SAML or OIDC connection. Shows the result of a test sign-in (`?test=success|domain`). |
| `components/ConnectionCard.tsx` | On/off (disabled while something is missing), Test sign-in (a one-time link), the values to copy into the IdP, IdP details (metadata XML or entity ID, URL and certificate; attribute names; OIDC issuer, client, write-only secret), domains with their TXT record and Verify, access (create accounts on first sign-in, default role, roles from IdP groups), delete. |
| `components/ScimSettings.tsx` | Base URL, tokens (shown once on create, revoke with confirmation). |
| `components/SsoDiscovery.tsx` | The login page's "Continue with SSO": asks for the work email, finds the connection and goes to it (`?email=` as a hint), else the deployment-wide SSO as before. A password sign-in refused with `SSO_REQUIRED` goes there too. |

## Privacy (W4-C)

`features/privacy/`. Backend contract: `backend/docs/wiki/modules/privacy.md`.

| Path (`features/privacy/…`) | Role |
| --- | --- |
| `types.ts`, `api/privacy.api.ts` | `GET /me/privacy`, `downloadMyData` (blob, saved through a link like the session exports), `confirmPassword`, `deleteAccount`. |
| `hooks/usePrivacyStatus.ts` | Loads the status; `refresh` re-reads after an export or a refused deletion. |
| `format.ts` | `formatBytes`, `listNames`, `deletionConsequences` (the dialog's list), `reauthValid`. |
| `components/PrivacySettings.tsx` | "Your data" (download with the last export and downloads left today, link to the workspace's data retention, the privacy policy) and "Delete account" (what goes and what stays, blockers with links to Members and Billing). |
| `components/DeleteAccountDialog.tsx` | Consequences, then proof of identity when the last sign-in is over 5 minutes old: the password, or for accounts without one "Log in again" (signs out, remembers `/settings/privacy` through `pendingInvite.ts`, back here after sign-in, also after Google/SSO via `/auth/complete`). On success: sign out, `/login?deleted=<purgeAt>` (the login page says when the account goes). |

Signing in during the 30 days cancels the deletion; the login toast says so (`restored`).

## Members, invitations, sharing, audit (W3-B1)

Backend contract: `backend/docs/wiki/modules/members-sharing.md`. Plain English strings like the rest
of the dashboard (next-intl serves the live routes only); native `<select>`s for roles.

| Path (`features/workspaces/…`) | Role |
| --- | --- |
| `members/types.ts`, `members/roles.ts` | API shapes; `assignableRoles`, `invitableRoles`, `canChangeMember` (mirror of the backend rank rules, the server still enforces), seat text. |
| `members/api/members.api.ts` | members CRUD, ownership transfer, invites list/create/revoke (path workspace, not `X-Workspace-Id`). |
| `members/components/MembersSettings.tsx` | `/settings/members`: seats, `InviteForm`, `MemberRow` list (role select, suspend, remove, leave, make primary owner), `PendingInvites`, confirm dialogs. Non-managers get a read-only roster. Personal workspaces get a one-line explanation. |
| `members/components/InviteForm.tsx` | Email + role; afterwards shows the invitation link and whether mail went out (`emailSent`): on a server without mail the owner copies it. The link is only returned on create/refresh, never in the pending list. |
| `invites/components/AcceptInvite.tsx` | `/invites/[token]` (public page, `app/invites/[token]/page.tsx`, `noindex`, no referrer): masked preview, "Sign in to accept" or "Join", error states (`INVITE_EMAIL_MISMATCH` offers to sign in with another account). After accepting it makes the workspace the default and the selection, then goes to `/polls`. |
| `invites/pendingInvite.ts` | Carries an invitation through sign-in: the invite page stores `/invites/<token>` in `localStorage` (24 h), and `LoginForm` / `useAuthPageRedirect` / `/auth/complete` (Google, SSO) call `takeInviteRedirect(?next)` after signing in. Only `/invites/<token>` paths and `/settings/privacy` (the deletion re-auth) are ever returned to. |
| `sharing/components/ShareDialog.tsx` | Who a deck (or folder) is shared with: members and groups, share role (editor, presenter, viewer), save = `PUT /api/shares` with the whole list. Entry point: **"Share with team…"** in the library deck card menu (`LibraryCard.tsx`), shown by `useCanShareDecks()` for team workspaces when the role is editor or above. |
| `sharing/shareModel.ts` | Pure list editing: candidates, add/change/remove, dirty check, redundant-share hint. |
| `audit/components/AuditLog.tsx` | `/settings/audit`: filters (action or action group, person), "Load older events" cursor paging, readable text from `audit/format.ts`. |

## Tests

`tests/unit/workspaces.store.test.ts` (selection logic, store actions, persistence),
`tests/unit/settings.sections.test.ts` (registry and gate order) and
`tests/unit/workspaces.members.test.ts` (role rules, seat text, invite redirect handling, share list
editing, audit text). Run with `bun run test`. `e2e/members.spec.ts` covers the whole journey: an
owner invites a teammate, who signs in through the invite link, joins as editor, sees the deck, cannot
manage members; the owner demotes them, shares the deck back through the ShareDialog, and reads it all
in the audit log.
