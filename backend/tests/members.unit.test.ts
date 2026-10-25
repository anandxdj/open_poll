import { describe, expect, it } from 'bun:test';
import { INVITE_ROLES, createInviteSchema, putSharesSchema, shareQuerySchema, updateMemberSchema } from '../src/modules/workspaces/members.schema';
import { memberChangeDenial } from '../src/modules/workspaces/members.service';
import { generateInviteToken, hashInviteToken, maskEmail } from '../src/modules/workspaces/invites.service';
import { auditQuerySchema } from '../src/modules/audit/audit.service';
import { WORKSPACE_ROLES, ROLE_RANK, type WorkspaceRole } from '../src/common/tenancy/roles';

const ID = '64b0000000000000000000a1';
const ID2 = '64b0000000000000000000a2';

describe('memberChangeDenial (who may change whom)', () => {
  const allowed = (actor: WorkspaceRole, target: WorkspaceRole, next?: WorkspaceRole) =>
    memberChangeDenial(actor, target, next) === null;

  it('lets managers act on members up to their own rank and assign roles up to it', () => {
    for (const actor of ['owner', 'admin'] as const) {
      for (const target of WORKSPACE_ROLES) {
        for (const next of [undefined, ...WORKSPACE_ROLES]) {
          const expected =
            (target !== 'owner' || actor === 'owner') &&
            ROLE_RANK[target] <= ROLE_RANK[actor] &&
            (next === undefined || ((next !== 'owner' || actor === 'owner') && ROLE_RANK[next] <= ROLE_RANK[actor]));
          expect(allowed(actor, target, next), `${actor} → ${target} → ${next}`).toBe(expected);
        }
      }
    }
  });

  it('keeps the owner role to owners', () => {
    expect(allowed('admin', 'owner')).toBe(false);
    expect(allowed('admin', 'editor', 'owner')).toBe(false);
    expect(allowed('owner', 'admin', 'owner')).toBe(true);
    expect(allowed('owner', 'owner', 'admin')).toBe(true);
  });

  it('explains the refusal', () => {
    expect(memberChangeDenial('admin', 'owner')).toContain('owner');
    expect(memberChangeDenial('editor', 'admin')).toContain('above yours');
    expect(memberChangeDenial('editor', 'viewer', 'admin')).toContain('above your own');
  });
});

describe('invite tokens and addresses', () => {
  it('makes unguessable tokens and stores only their hash', () => {
    const [a, b] = [generateInviteToken(), generateInviteToken()];
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashInviteToken(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInviteToken(a)).toBe(hashInviteToken(a));
    expect(hashInviteToken(a)).not.toBe(hashInviteToken(b));
  });

  it('masks addresses for the public preview', () => {
    expect(maskEmail('ana@example.com')).toBe('a**@example.com');
    expect(maskEmail('someone@example.com')).toBe('s******@example.com');
    expect(maskEmail('x@example.com')).toBe('x**@example.com');
    expect(maskEmail('ana@example.com')).not.toContain('na@');
  });
});

describe('request schemas', () => {
  it('createInviteSchema normalizes the address and refuses owners and extras', () => {
    expect(createInviteSchema.parse({ email: '  Ana@Example.COM ', role: 'editor' })).toEqual({ email: 'ana@example.com', role: 'editor' });
    expect([...INVITE_ROLES]).toEqual(['admin', 'editor', 'presenter', 'viewer']);
    for (const body of [
      { email: 'ana@example.com', role: 'owner' },
      { email: 'not-an-email', role: 'viewer' },
      { email: 'ana@example.com' },
      { role: 'viewer' },
      { email: 'ana@example.com', role: 'viewer', workspaceId: ID },
      { email: `${'a'.repeat(250)}@example.com`, role: 'viewer' },
    ]) {
      expect(createInviteSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('updateMemberSchema needs a role or a status and never accepts invited', () => {
    expect(updateMemberSchema.safeParse({ role: 'admin' }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ status: 'suspended' }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ role: 'viewer', status: 'active' }).success).toBe(true);
    for (const body of [{}, { status: 'invited' }, { role: 'god' }, { role: 'admin', extra: 1 }]) {
      expect(updateMemberSchema.safeParse(body).success).toBe(false);
    }
  });

  it('putSharesSchema takes share roles only, ids that look like ids and one grant per principal', () => {
    const grant = (principalId: string, role = 'viewer', principalType = 'user') => ({ principalType, principalId, role });
    expect(putSharesSchema.safeParse({ shares: [] }).success).toBe(true);
    expect(putSharesSchema.safeParse({ shares: [grant(ID), grant(ID2, 'editor', 'group')] }).success).toBe(true);
    // The same id as a user and as a group are two different principals.
    expect(putSharesSchema.safeParse({ shares: [grant(ID), grant(ID, 'viewer', 'group')] }).success).toBe(true);
    for (const body of [
      { shares: [grant(ID), grant(ID, 'editor')] },
      { shares: [grant(ID, 'owner')] },
      { shares: [grant(ID, 'admin')] },
      { shares: [grant('nope')] },
      { shares: [grant(ID, 'viewer', 'team')] },
      { shares: [{ ...grant(ID), extra: true }] },
      { shares: Array.from({ length: 201 }, (_, i) => grant(`64b00000000000000000${String(i).padStart(4, '0')}`)) },
      {},
    ]) {
      expect(putSharesSchema.safeParse(body).success).toBe(false);
    }
  });

  it('shareQuerySchema takes a deck or folder id', () => {
    expect(shareQuerySchema.safeParse({ resourceType: 'presentation', resourceId: ID }).success).toBe(true);
    expect(shareQuerySchema.safeParse({ resourceType: 'folder', resourceId: ID }).success).toBe(true);
    expect(shareQuerySchema.safeParse({ resourceType: 'poll', resourceId: ID }).success).toBe(false);
    expect(shareQuerySchema.safeParse({ resourceType: 'folder', resourceId: 'x' }).success).toBe(false);
  });

  it('auditQuerySchema bounds the page and the filters', () => {
    expect(auditQuerySchema.parse({}).limit).toBe(50);
    expect(auditQuerySchema.parse({ limit: '10', action: 'member.*', actor: ID, cursor: '' })).toEqual({ limit: 10, action: 'member.*', actor: ID });
    for (const query of [{ limit: '0' }, { limit: '101' }, { actor: 'x' }, { action: 'a b' }, { action: '.*(' }]) {
      expect(auditQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});
