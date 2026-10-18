/**
 * Workspace roles and the actions each one may perform. The matrix is the
 * whole policy for workspace members; per-resource grants (ResourceShare) are
 * layered on top in policy.ts by W3-B1.
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

const VIEWER: readonly Action[] = ['deck:read', 'session:read'];
const PRESENTER: readonly Action[] = [...VIEWER, 'deck:host', 'session:export'];
const EDITOR: readonly Action[] = [...DECK_ACTIONS, ...SESSION_ACTIONS];
// Billing (plan, payment method, invoices) stays with the owner.
const ADMIN: readonly Action[] = [...EDITOR, ...WORKSPACE_ACTIONS.filter((action) => action !== 'workspace:billing')];
const OWNER: readonly Action[] = ACTIONS;

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, ReadonlySet<Action>>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  editor: new Set(EDITOR),
  presenter: new Set(PRESENTER),
  viewer: new Set(VIEWER),
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
