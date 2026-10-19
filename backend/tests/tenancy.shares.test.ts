import { describe, expect, it } from 'bun:test';
import { assertCan, can, effectiveShareRole, evaluate, type PolicyContext, type ShareGrant } from '../src/common/tenancy/policy';
import {
  ACTIONS,
  ACTION_MATRIX,
  ROLE_PERMISSIONS,
  SHAREABLE_ACTIONS,
  SHARE_PERMISSIONS,
  SHARE_ROLES,
  WORKSPACE_ROLES,
  isShareRole,
  roleAllows,
  shareAllows,
  type Action,
  type ShareRole,
  type WorkspaceRole,
} from '../src/common/tenancy/roles';

const WS = '64b0000000000000000000a1';
const OTHER_WS = '64b0000000000000000000b2';
const ME = '64b0000000000000000000c3';
const SOMEONE = '64b0000000000000000000d4';
const DECK = '64b0000000000000000000e5';
const OTHER_DECK = '64b0000000000000000000e6';
const FOLDER = '64b0000000000000000000f7';
const OTHER_FOLDER = '64b0000000000000000000f8';

const ctx = (role: WorkspaceRole, shareGrants?: readonly ShareGrant[], status = 'active'): PolicyContext => ({
  user: { id: ME },
  workspace: { _id: WS },
  membership: { role, status, workspaceId: WS },
  shareGrants,
});

const deck = { _id: DECK, workspaceId: WS, creatorId: SOMEONE, folderId: null };
const deckInFolder = { ...deck, folderId: FOLDER };
const onDeck = (role: ShareRole): ShareGrant => ({ resourceType: 'presentation', resourceId: DECK, role });
const onFolder = (role: ShareRole): ShareGrant => ({ resourceType: 'folder', resourceId: FOLDER, role });

describe('the action matrix', () => {
  it('has a row for every action and a column for every role', () => {
    expect(Object.keys(ACTION_MATRIX).sort()).toEqual([...ACTIONS].sort());
    for (const action of ACTIONS) expect(Object.keys(ACTION_MATRIX[action]).sort()).toEqual([...WORKSPACE_ROLES].sort());
  });

  it('only gives a role what every higher role has too (roles nest)', () => {
    for (let i = 0; i < WORKSPACE_ROLES.length - 1; i += 1) {
      const higher = ROLE_PERMISSIONS[WORKSPACE_ROLES[i]!];
      const lower = ROLE_PERMISSIONS[WORKSPACE_ROLES[i + 1]!];
      for (const action of lower) expect(higher.has(action)).toBe(true);
    }
  });

  it('keeps billing with the owner and the workspace actions with owner and admin', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(roleAllows(role, 'workspace:billing')).toBe(role === 'owner');
      for (const action of ['workspace:manage', 'workspace:members', 'workspace:sso', 'workspace:domains', 'workspace:brand'] as const) {
        expect(roleAllows(role, action)).toBe(role === 'owner' || role === 'admin');
      }
    }
  });
});

describe('share roles', () => {
  it('are the three resource-level roles', () => {
    expect([...SHARE_ROLES]).toEqual(['editor', 'presenter', 'viewer']);
    expect(isShareRole('editor')).toBe(true);
    expect(isShareRole('admin')).toBe(false);
    expect(isShareRole('owner')).toBe(false);
    expect(isShareRole(undefined)).toBe(false);
  });

  it('add exactly the shareable actions their workspace role has', () => {
    const expected: Record<ShareRole, Action[]> = {
      editor: ['deck:read', 'deck:edit', 'deck:host', 'deck:export', 'session:read', 'session:export', 'session:share'],
      presenter: ['deck:read', 'deck:host', 'session:read', 'session:export'],
      viewer: ['deck:read', 'session:read'],
    };
    for (const role of SHARE_ROLES) expect([...SHARE_PERMISSIONS[role]].sort()).toEqual([...expected[role]].sort());
  });

  it('never exceed the same workspace role, and never include structural or workspace actions', () => {
    for (const role of SHARE_ROLES) {
      for (const action of SHARE_PERMISSIONS[role]) {
        expect(roleAllows(role, action)).toBe(true);
        expect(SHAREABLE_ACTIONS).toContain(action);
      }
      for (const action of ['deck:create', 'deck:delete', 'deck:share', 'workspace:manage', 'workspace:members', 'workspace:billing'] as const) {
        expect(shareAllows(role, action)).toBe(false);
      }
    }
  });
});

describe('effectiveShareRole', () => {
  it('is null without grants or a resource', () => {
    expect(effectiveShareRole(undefined, deck)).toBeNull();
    expect(effectiveShareRole([], deck)).toBeNull();
    expect(effectiveShareRole([onDeck('viewer')], null)).toBeNull();
  });

  it('matches a grant on the deck itself', () => {
    expect(effectiveShareRole([onDeck('presenter')], deck)).toBe('presenter');
    expect(effectiveShareRole([{ ...onDeck('editor'), resourceId: OTHER_DECK }], deck)).toBeNull();
  });

  it('matches a grant on the folder the deck sits in, not on a different folder or a deck without one', () => {
    expect(effectiveShareRole([onFolder('viewer')], deckInFolder)).toBe('viewer');
    expect(effectiveShareRole([{ ...onFolder('viewer'), resourceId: OTHER_FOLDER }], deckInFolder)).toBeNull();
    expect(effectiveShareRole([onFolder('viewer')], deck)).toBeNull();
  });

  it('does not mistake a deck id for a folder id or the reverse', () => {
    expect(effectiveShareRole([{ resourceType: 'folder', resourceId: DECK, role: 'editor' }], deck)).toBeNull();
    expect(effectiveShareRole([{ resourceType: 'presentation', resourceId: FOLDER, role: 'editor' }], deckInFolder)).toBeNull();
  });

  it('takes the strongest of several applicable grants (user and group grants alike)', () => {
    expect(effectiveShareRole([onFolder('editor'), onDeck('viewer')], deckInFolder)).toBe('editor');
    expect(effectiveShareRole([onDeck('viewer'), onDeck('presenter')], deck)).toBe('presenter');
  });

  it('matches folders themselves when the resource is a folder', () => {
    const folder = { _id: FOLDER, workspaceId: WS, kind: 'folder' as const };
    expect(effectiveShareRole([onFolder('presenter')], folder)).toBe('presenter');
    expect(effectiveShareRole([onDeck('presenter')], { ...folder, _id: DECK })).toBeNull();
  });
});

describe('evaluate with share grants', () => {
  it('raises a viewer to what the share role allows on that deck only', () => {
    const grants = [onDeck('editor')];
    for (const action of SHARE_PERMISSIONS.editor) {
      // `via` tells whether the role already allowed it (read) or the share added it.
      const via = roleAllows('viewer', action) ? 'role' : 'share';
      expect(evaluate(ctx('viewer', grants), action, deck)).toEqual({ allowed: true, via });
    }
    expect(evaluate(ctx('viewer', grants), 'deck:edit', deck)).toEqual({ allowed: true, via: 'share' });
    // The same viewer is still a viewer elsewhere.
    expect(can(ctx('viewer', grants), 'deck:edit', { ...deck, _id: OTHER_DECK })).toBe(false);
    expect(can(ctx('viewer', grants), 'deck:edit')).toBe(false);
  });

  it('keeps structural actions with the workspace role, whatever the share says', () => {
    const grants = [onDeck('editor'), onFolder('editor')];
    for (const action of ['deck:create', 'deck:delete', 'deck:share'] as const) {
      expect(can(ctx('viewer', grants), action, deckInFolder)).toBe(false);
      expect(can(ctx('presenter', grants), action, deckInFolder)).toBe(false);
    }
    for (const action of ['workspace:manage', 'workspace:members', 'workspace:billing', 'workspace:sso'] as const) {
      expect(can(ctx('viewer', grants), action, deckInFolder)).toBe(false);
    }
  });

  it('a viewer share adds nothing to a presenter, and a share never lowers a role', () => {
    expect(can(ctx('presenter', [onDeck('viewer')]), 'deck:host', deck)).toBe(true);
    expect(evaluate(ctx('presenter', [onDeck('viewer')]), 'deck:host', deck)).toEqual({ allowed: true, via: 'role' });
    expect(can(ctx('editor', [onDeck('viewer')]), 'deck:edit', deck)).toBe(true);
  });

  it('applies a folder share to decks in that folder', () => {
    expect(can(ctx('viewer', [onFolder('presenter')]), 'deck:host', deckInFolder)).toBe(true);
    expect(can(ctx('viewer', [onFolder('presenter')]), 'deck:host', deck)).toBe(false);
  });

  it('presenter share on a viewer allows hosting but not editing', () => {
    const grants = [onDeck('presenter')];
    expect(can(ctx('viewer', grants), 'deck:host', deck)).toBe(true);
    expect(can(ctx('viewer', grants), 'session:export', deck)).toBe(true);
    expect(can(ctx('viewer', grants), 'deck:edit', deck)).toBe(false);
  });

  it('never crosses workspaces, suspended memberships or missing users', () => {
    const grants = [onDeck('editor')];
    expect(evaluate(ctx('viewer', grants), 'deck:edit', { ...deck, workspaceId: OTHER_WS })).toEqual({
      allowed: false,
      reason: 'other_workspace',
    });
    expect(evaluate(ctx('viewer', grants, 'suspended'), 'deck:read', deck)).toEqual({ allowed: false, reason: 'not_member' });
    expect(evaluate({ ...ctx('viewer', grants), user: null }, 'deck:read', deck)).toEqual({ allowed: false, reason: 'unauthenticated' });
    expect(evaluate({ user: { id: ME }, shareGrants: grants }, 'deck:read', deck)).toEqual({ allowed: false, reason: 'not_member' });
  });

  it('is ignored by the creator fallback for decks without a workspace', () => {
    const legacy = { _id: DECK, creatorId: SOMEONE };
    expect(can(ctx('owner', [onDeck('editor')]), 'deck:read', legacy)).toBe(false);
    expect(evaluate(ctx('viewer'), 'deck:edit', { ...legacy, creatorId: ME })).toEqual({ allowed: true, via: 'creator' });
  });

  it('assertCan throws FORBIDDEN without the grant and passes with it', () => {
    expect(() => assertCan(ctx('viewer'), 'deck:edit', deck)).toThrow(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
    expect(() => assertCan(ctx('viewer', [onDeck('editor')]), 'deck:edit', deck)).not.toThrow();
  });
});
