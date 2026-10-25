/**
 * Workspace roles and the actions each one may perform. The matrix below is
 * the whole policy for workspace members; per-resource grants (ResourceShare)
 * are layered on top in policy.ts and can only add the actions listed in
 * SHAREABLE_ACTIONS (see backend/docs/wiki/platform/tenancy.md).
 */

export const WORKSPACE_ROLES = ['owner', 'admin', 'editor', 'presenter', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const MEMBER_STATUSES = ['active', 'invited', 'suspended'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const DECK_ACTIONS = [
  'deck:create',
  'deck:read',
  'deck:edit',
  'deck:delete',
  'deck:host',
  'deck:share',
  'deck:export',
] as const;
export const SESSION_ACTIONS = ['session:read', 'session:export', 'session:share'] as const;
export const WORKSPACE_ACTIONS = [
  'workspace:manage',
  'workspace:billing',
  'workspace:members',
  'workspace:sso',
  'workspace:domains',
  'workspace:brand',
] as const;
export const ACTIONS = [...DECK_ACTIONS, ...SESSION_ACTIONS, ...WORKSPACE_ACTIONS] as const;
export type Action = (typeof ACTIONS)[number];

type Row = Readonly<Record<WorkspaceRole, boolean>>;
const row = (owner: boolean, admin: boolean, editor: boolean, presenter: boolean, viewer: boolean): Row => ({
  owner,
  admin,
  editor,
  presenter,
  viewer,
});
const Y = true;
const N = false;

/**
 * The action matrix, written out explicitly: one row per action, one column
 * per role, `Y` = the role may perform the action anywhere in its workspace.
 *
 * - owner: everything, including billing (plan, payment method, invoices).
 * - admin: everything except billing.
 * - editor: every deck and session action, no workspace administration.
 * - presenter: read, host and export results; no editing or sharing.
 * - viewer: read decks and session results.
 */
export const ACTION_MATRIX: Readonly<Record<Action, Row>> = {
  //                     owner admin editor presenter viewer
  'deck:create':       row(Y, Y, Y, N, N),
  'deck:read':         row(Y, Y, Y, Y, Y),
  'deck:edit':         row(Y, Y, Y, N, N),
  'deck:delete':       row(Y, Y, Y, N, N),
  'deck:host':         row(Y, Y, Y, Y, N),
  'deck:share':        row(Y, Y, Y, N, N),
  'deck:export':       row(Y, Y, Y, N, N),
  'session:read':      row(Y, Y, Y, Y, Y),
  'session:export':    row(Y, Y, Y, Y, N),
  'session:share':     row(Y, Y, Y, N, N),
  'workspace:manage':  row(Y, Y, N, N, N),
  'workspace:billing': row(Y, N, N, N, N),
  'workspace:members': row(Y, Y, N, N, N),
  'workspace:sso':     row(Y, Y, N, N, N),
  'workspace:domains': row(Y, Y, N, N, N),
  'workspace:brand':   row(Y, Y, N, N, N),
};

const permissionsOf = (role: WorkspaceRole): ReadonlySet<Action> =>
  new Set(ACTIONS.filter((action) => ACTION_MATRIX[action][role]));

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, ReadonlySet<Action>>> = {
  owner: permissionsOf('owner'),
  admin: permissionsOf('admin'),
  editor: permissionsOf('editor'),
  presenter: permissionsOf('presenter'),
  viewer: permissionsOf('viewer'),
};

/** Higher rank = more privilege; for "at least" checks such as who may assign which role. */
export const ROLE_RANK: Readonly<Record<WorkspaceRole, number>> = {
  owner: 5,
  admin: 4,
  editor: 3,
  presenter: 2,
  viewer: 1,
};

export const isWorkspaceRole = (value: unknown): value is WorkspaceRole =>
  typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);

export const roleAllows = (role: WorkspaceRole, action: Action): boolean =>
  ROLE_PERMISSIONS[role]?.has(action) ?? false;

export const isRoleAtLeast = (role: WorkspaceRole, minimum: WorkspaceRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[minimum];

/** Roles a ResourceShare may grant. Owner and admin are workspace-wide and never granted per resource. */
export const SHARE_ROLES = ['editor', 'presenter', 'viewer'] as const satisfies readonly WorkspaceRole[];
export type ShareRole = (typeof SHARE_ROLES)[number];

export const isShareRole = (value: unknown): value is ShareRole =>
  typeof value === 'string' && (SHARE_ROLES as readonly string[]).includes(value);

/**
 * Actions a share can add on its one resource. Everything else stays with the
 * workspace role: creating decks (not resource-scoped), deleting and
 * re-sharing (structural), and every workspace action.
 */
export const SHAREABLE_ACTIONS: readonly Action[] = [
  'deck:read',
  'deck:edit',
  'deck:host',
  'deck:export',
  'session:read',
  'session:export',
  'session:share',
];

const sharePermissionsOf = (role: ShareRole): ReadonlySet<Action> =>
  new Set(SHAREABLE_ACTIONS.filter((action) => roleAllows(role, action)));

/**
 * What a share of `role` adds on its resource: the actions a workspace member
 * with that role could perform there, limited to SHAREABLE_ACTIONS. A share
 * therefore never exceeds what the same workspace role allows.
 */
export const SHARE_PERMISSIONS: Readonly<Record<ShareRole, ReadonlySet<Action>>> = {
  editor: sharePermissionsOf('editor'),
  presenter: sharePermissionsOf('presenter'),
  viewer: sharePermissionsOf('viewer'),
};

export const shareAllows = (role: ShareRole, action: Action): boolean => SHARE_PERMISSIONS[role]?.has(action) ?? false;
