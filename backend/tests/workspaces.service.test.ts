import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../src/modules/workspaces/workspaceMember.model';
import { createWorkspaceSchema, updateWorkspaceSchema } from '../src/modules/workspaces/workspaces.schema';
import {
  MAX_SINGLE_SEAT_TEAM_WORKSPACES,
  WorkspaceService,
  toWorkspaceDetail,
  type WorkspaceActor,
} from '../src/modules/workspaces/workspaces.service';

const id = () => new mongoose.Types.ObjectId();
const USER_ID = String(id());

const workspace = (fields: Record<string, unknown> = {}): any => ({
  _id: id(),
  name: 'Acme',
  slug: 'acme-abc123',
  type: 'team',
  ownerId: USER_ID,
  plan: 'free',
  planOverrides: null,
  billing: {},
  settings: { retentionDays: null, requireSso: false, allowedEmailDomains: [], embedAllowedOrigins: [], defaultTheme: null },
  deletedAt: null,
  ...fields,
});

const actor = (role: string, fields: Record<string, unknown> = {}): WorkspaceActor => {
  const ws = workspace(fields);
  return {
    user: { id: USER_ID },
    workspace: ws,
    membership: { workspaceId: ws._id, userId: USER_ID, role, status: 'active' } as any,
  };
};

const saved = {
  wsFind: WorkspaceModel.find,
  wsCreate: WorkspaceModel.create,
  wsUpdate: WorkspaceModel.findOneAndUpdate,
  wsDelete: WorkspaceModel.deleteOne,
  memberUpsert: WorkspaceMemberModel.findOneAndUpdate,
};

let owned: any[];
let created: any[];
let createFailures: number;
let lastUpdate: { filter: any; update: any } | null;

beforeEach(() => {
  owned = [];
  created = [];
  createFailures = 0;
  lastUpdate = null;
  (WorkspaceModel as any).find = () => ({ select: async () => owned });
  (WorkspaceModel as any).create = async (data: any) => {
    if (createFailures > 0) {
      createFailures -= 1;
      throw Object.assign(new Error('E11000 duplicate key error (slug)'), { code: 11000 });
    }
    const doc = workspace(data);
    created.push(doc);
    return doc;
  };
  (WorkspaceModel as any).findOneAndUpdate = async (filter: any, update: any) => {
    lastUpdate = { filter, update };
    return workspace({ _id: filter._id, ...update.$set });
  };
  (WorkspaceModel as any).deleteOne = async () => ({ deletedCount: 1 });
  (WorkspaceMemberModel as any).findOneAndUpdate = async (filter: any, update: any) => ({
    _id: id(),
    ...filter,
    ...update.$setOnInsert,
  });
});

afterEach(() => {
  (WorkspaceModel as any).find = saved.wsFind;
  (WorkspaceModel as any).create = saved.wsCreate;
  (WorkspaceModel as any).findOneAndUpdate = saved.wsUpdate;
  (WorkspaceModel as any).deleteOne = saved.wsDelete;
  (WorkspaceMemberModel as any).findOneAndUpdate = saved.memberUpsert;
});

describe('toWorkspaceDetail', () => {
  it('lists exactly the actions the role allows, with the plan entitlements', () => {
    const editor = toWorkspaceDetail(actor('editor', { plan: 'pro' }));
    expect(editor.membership).toEqual({ role: 'editor', status: 'active' });
    expect(editor.permissions).toContain('deck:edit');
    expect(editor.permissions.some((action) => action.startsWith('workspace:'))).toBe(false);
    expect(editor.entitlements.plan).toBe('pro');
    expect(editor.entitlements.features.brand_kits).toBe(true);

    expect(toWorkspaceDetail(actor('admin')).permissions).not.toContain('workspace:billing');
    expect(toWorkspaceDetail(actor('owner')).permissions).toContain('workspace:billing');
  });

  it('never exposes billing ids or plan overrides', () => {
    const detail = toWorkspaceDetail(
      actor('owner', { billing: { stripeCustomerId: 'cus_123' }, planOverrides: { limits: { audienceCap: 5 } } }),
    );
    expect(JSON.stringify(detail)).not.toContain('cus_123');
    expect(detail.workspace).not.toHaveProperty('planOverrides');
    expect(detail.entitlements.limits.audienceCap).toBe(5);
  });
});

describe('WorkspaceService.create', () => {
  it('creates a team workspace on the free plan with the creator as owner', async () => {
    const { workspace: ws, membership } = await WorkspaceService.create(USER_ID, { name: 'Acme Design' });
    expect(ws.type).toBe('team');
    expect(String(ws.ownerId)).toBe(USER_ID);
    expect(ws.slug).toMatch(/^acme-design-[0-9a-f]{6}$/);
    expect(ws.plan).toBe('free');
    expect(membership.role).toBe('owner');
    expect(String(membership.userId)).toBe(USER_ID);
  });

  it(`allows ${MAX_SINGLE_SEAT_TEAM_WORKSPACES} single-seat team workspace, then asks for an upgrade`, async () => {
    owned = [workspace({ name: 'First team' })];
    const attempt = WorkspaceService.create(USER_ID, { name: 'Second team' });
    await expect(attempt).rejects.toMatchObject({
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 'singleSeatTeamWorkspaces', max: 1, plan: 'free', workspaceId: String(owned[0]._id) },
    });
    expect(created).toHaveLength(0);
  });

  it('allows another team workspace once the existing ones have more seats', async () => {
    owned = [
      workspace({ plan: 'team' }),
      workspace({ plan: 'free', planOverrides: { limits: { seats: 3 } } }),
      workspace({ plan: 'pro', billing: { seats: 10 } }),
    ];
    await WorkspaceService.create(USER_ID, { name: 'Another' });
    expect(created).toHaveLength(1);
  });

  it('retries a colliding slug', async () => {
    createFailures = 2;
    await WorkspaceService.create(USER_ID, { name: 'Acme' });
    expect(created).toHaveLength(1);
  });

  it('removes the workspace again when the owner membership cannot be written', async () => {
    let deleted: unknown;
    (WorkspaceModel as any).deleteOne = async (filter: any) => {
      deleted = filter._id;
      return { deletedCount: 1 };
    };
    (WorkspaceMemberModel as any).findOneAndUpdate = async () => {
      throw new Error('write failed');
    };
    await expect(WorkspaceService.create(USER_ID, { name: 'Acme' })).rejects.toThrow('write failed');
    expect(String(deleted)).toBe(String(created[0]._id));
  });
});

describe('WorkspaceService.update', () => {
  it('needs workspace:manage', async () => {
    await expect(WorkspaceService.update(actor('editor'), { name: 'Renamed' })).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
      details: { action: 'workspace:manage' },
    });
    expect(lastUpdate).toBeNull();
  });

  it('renames and sets retention within the plan', async () => {
    const admin = actor('admin');
    const { workspace: ws } = await WorkspaceService.update(admin, { name: 'Renamed', settings: { retentionDays: 90 } });
    expect(lastUpdate!.filter).toEqual({ _id: admin.workspace._id, deletedAt: null });
    expect(lastUpdate!.update.$set).toEqual({ name: 'Renamed', 'settings.retentionDays': 90 });
    expect(ws.name).toBe('Renamed');
  });

  it('rejects retention beyond the plan, and accepts clearing it', async () => {
    await expect(WorkspaceService.update(actor('owner'), { settings: { retentionDays: 366 } })).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 'retentionDays', max: 365, plan: 'free' },
    });
    await WorkspaceService.update(actor('owner'), { settings: { retentionDays: null } });
    expect(lastUpdate!.update.$set).toEqual({ 'settings.retentionDays': null });
  });

  it('answers 404 when the workspace was deleted meanwhile', async () => {
    (WorkspaceModel as any).findOneAndUpdate = async () => null;
    await expect(WorkspaceService.update(actor('owner'), { name: 'Gone' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('workspace request schemas', () => {
  it('only takes a name on create', () => {
    expect(createWorkspaceSchema.parse({ name: '  Acme  ' })).toEqual({ name: 'Acme' });
    expect(createWorkspaceSchema.safeParse({ name: 'Acme', plan: 'enterprise' }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: 'Acme', type: 'personal' }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects empty updates and fields the module does not own', () => {
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ settings: {} }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ plan: 'team' }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ settings: { allowedEmailDomains: ['x.com'] } }).success).toBe(false);
    expect(updateWorkspaceSchema.parse({ settings: { requireSso: true } })).toEqual({ settings: { requireSso: true } });
    expect(updateWorkspaceSchema.safeParse({ settings: { retentionDays: 0 } }).success).toBe(false);
    expect(updateWorkspaceSchema.parse({ settings: { retentionDays: null } })).toEqual({ settings: { retentionDays: null } });
  });
});
