import { describe, expect, it } from 'bun:test';
import { assertCan, can, evaluate } from '../src/common/tenancy/policy';
import { ACTIONS, WORKSPACE_ROLES, type Action, type WorkspaceRole } from '../src/common/tenancy/roles';

const WS = '64b0000000000000000000a1';
const OTHER_WS = '64b0000000000000000000b2';
const ME = '64b0000000000000000000c3';
const SOMEONE = '64b0000000000000000000d4';

/** The intended matrix, written out by hand (not derived from roles.ts). */
const ALLOWED: Record<WorkspaceRole, Action[]> = {
  owner: [
    'deck:create', 'deck:read', 'deck:edit', 'deck:delete', 'deck:host', 'deck:share', 'deck:export',
    'session:read', 'session:export', 'session:share',
    'workspace:manage', 'workspace:billing', 'workspace:members', 'workspace:sso', 'workspace:domains', 'workspace:brand',
  ],
  admin: [
    'deck:create', 'deck:read', 'deck:edit', 'deck:delete', 'deck:host', 'deck:share', 'deck:export',
    'session:read', 'session:export', 'session:share',
    'workspace:manage', 'workspace:members', 'workspace:sso', 'workspace:domains', 'workspace:brand',
  ],
  editor: [
    'deck:create', 'deck:read', 'deck:edit', 'deck:delete', 'deck:host', 'deck:share', 'deck:export',
    'session:read', 'session:export', 'session:share',
  ],
  presenter: ['deck:read', 'deck:host', 'session:read', 'session:export'],
  viewer: ['deck:read', 'session:read'],
};

const ctx = (role: WorkspaceRole, status = 'active') => ({
  user: { id: ME },
  workspace: { _id: WS },
  membership: { role, status, workspaceId: WS },
});

const deckInWorkspace = { workspaceId: WS, creatorId: SOMEONE };

describe('policy matrix', () => {
  it('covers exactly the documented actions', () => {
    expect([...ACTIONS].sort()).toEqual([...new Set(Object.values(ALLOWED).flat())].sort());
  });

  for (const role of WORKSPACE_ROLES) {
    for (const action of ACTIONS) {
      const expected = ALLOWED[role].includes(action);
      it(`${role} ${expected ? 'may' : 'may not'} ${action}`, () => {
        // Same answer with and without a resource of the current workspace.
        expect(can(ctx(role), action)).toBe(expected);
        expect(can(ctx(role), action, deckInWorkspace)).toBe(expected);
      });
    }
  }
});

describe('policy context checks', () => {
  it('denies every role on a resource of another workspace', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(evaluate(ctx(role), 'deck:read', { workspaceId: OTHER_WS, creatorId: ME })).toEqual({
        allowed: false,
        reason: 'other_workspace',
      });
    }
  });

  it('denies invited and suspended members', () => {
    expect(evaluate(ctx('owner', 'invited'), 'deck:read')).toEqual({ allowed: false, reason: 'not_member' });
    expect(evaluate(ctx('owner', 'suspended'), 'deck:read', deckInWorkspace)).toEqual({ allowed: false, reason: 'not_member' });
  });

  it('denies without workspace context or with a membership of another workspace', () => {
    expect(can({ user: { id: ME } }, 'deck:create')).toBe(false);
    expect(
      can({ user: { id: ME }, workspace: { _id: WS }, membership: { role: 'owner', status: 'active', workspaceId: OTHER_WS } }, 'deck:create'),
    ).toBe(false);
  });

  it('compares ids by value (ObjectId vs string)', () => {
    const objectIdLike = { toString: () => WS };
    expect(can({ ...ctx('editor'), workspace: { _id: objectIdLike } }, 'deck:edit', { workspaceId: WS })).toBe(true);
  });
});

describe('creatorId fallback for resources without workspaceId', () => {
  const legacyDeck = (creatorId: string) => ({ creatorId });

  it('lets the creator do anything, whatever their role or membership', () => {
    for (const action of ACTIONS) {
      expect(can(ctx('viewer'), action, legacyDeck(ME))).toBe(true);
      expect(can({ user: { id: ME } }, action, { ...legacyDeck(ME), workspaceId: null })).toBe(true);
    }
  });

  it('denies everyone else, even workspace owners', () => {
    for (const action of ACTIONS) {
      expect(evaluate(ctx('owner'), action, legacyDeck(SOMEONE))).toEqual({ allowed: false, reason: 'not_creator' });
    }
  });
});

describe('assertCan', () => {
  it('passes silently when allowed', () => {
    expect(() => assertCan(ctx('editor'), 'deck:edit', deckInWorkspace)).not.toThrow();
  });

  it('throws 401 without a user', () => {
    expect(() => assertCan({}, 'deck:read')).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  it('throws 403 FORBIDDEN without revealing why', () => {
    let thrown: any;
    try {
      assertCan(ctx('viewer'), 'deck:edit', { workspaceId: OTHER_WS });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ statusCode: 403, code: 'FORBIDDEN', details: { action: 'deck:edit' } });
    expect(thrown.details.reason).toBeUndefined();
  });
});
