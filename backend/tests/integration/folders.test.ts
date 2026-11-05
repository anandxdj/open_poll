import { afterAll, beforeAll, beforeEach, expect, it, describe } from 'bun:test';
import mongoose from 'mongoose';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { FolderModel } from '../../src/modules/folders/folder.model';
import { PollModel } from '../../src/modules/polls/polls.model';
import { PresentationModel } from '../../src/modules/presentations/presentations.model';
import { ResourceShareModel } from '../../src/modules/workspaces/resourceShare.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import migration210 from '../../src/migrations/210-folders';
import { createPoll, createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * W3-B2 folders and templates through the real app: folder CRUD, filing decks
 * and polls, the library's folder filter, folder shares (and their removal
 * with the folder), roles, the workspace boundary, migration 210, and the
 * templates API (starters, save as template, use, delete).
 */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: Record<string, unknown>; data: T };

describeIntegration('folders and templates over HTTP', () => {
  let server: TestServer;
  let alice!: TestUser; // owner of Alpha
  let erin!: TestUser; // editor in Alpha
  let carol!: TestUser; // viewer in Alpha
  let bob!: TestUser; // owner of Beta
  let wsA!: string;
  let wsB!: string;

  const call = async <T = any>(user: TestUser | null, method: string, path: string, options: { body?: unknown; workspace?: string } = {}) => {
    const headers: Record<string, string> = { ...(user?.headers ?? {}) };
    if (options.workspace) headers['X-Workspace-Id'] = options.workspace;
    const res = await server.request(path, { method, headers, body: options.body });
    return { status: res.status, body: (await res.json().catch(() => null)) as Body<T> };
  };
  const inA = (user: TestUser): TestUser => ({ ...user, headers: { ...user.headers, 'x-workspace-id': wsA } as TestUser['headers'] });
  const inB = (user: TestUser): TestUser => ({ ...user, headers: { ...user.headers, 'x-workspace-id': wsB } as TestUser['headers'] });

  const createFolder = async (user: TestUser, name: string, workspace = wsA) => {
    const res = await call(user, 'POST', '/api/folders', { body: { name }, workspace });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.folder as { id: string; name: string };
  };
  const move = (user: TestUser, folderId: string | null, items: { entityType: 'presentation' | 'poll'; id: string }[], workspace = wsA) =>
    call(user, 'POST', '/api/folders/move', { body: { folderId, items }, workspace });
  const library = async (user: TestUser, query: string, workspace = wsA) => {
    const res = await call(user, 'GET', `/api/library${query}`, { workspace });
    expect(res.status).toBe(200);
    return res.body.data as { items: { id: string; entityType: string; folderId: string | null }[]; counts?: { all: number } };
  };
  const auditEvent = async (action: string) => {
    for (let i = 0; i < 50; i++) {
      const event = await AuditEventModel.findOne({ action }).lean();
      if (event) return event;
      await Bun.sleep(20);
    }
    throw new Error(`No ${action} audit event`);
  };

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(async () => {
    await resetTestData();
    [alice, erin, carol, bob] = await Promise.all([
      createVerifiedUser({ name: 'Alice' }),
      createVerifiedUser({ name: 'Erin' }),
      createVerifiedUser({ name: 'Carol' }),
      createVerifiedUser({ name: 'Bob' }),
    ]);
    wsA = (await call(alice, 'POST', '/api/workspaces', { body: { name: 'Alpha' } })).body.data.workspace._id;
    wsB = (await call(bob, 'POST', '/api/workspaces', { body: { name: 'Beta' } })).body.data.workspace._id;
    await WorkspaceModel.updateMany({ _id: { $in: [wsA, wsB] } }, { $set: { plan: 'team' } });
    await WorkspaceMemberModel.create([
      { workspaceId: wsA, userId: erin.id, role: 'editor' },
      { workspaceId: wsA, userId: carol.id, role: 'viewer' },
    ]);
  });

  describe('folders', () => {
    it('creates, lists with counts, renames and refuses a second folder of the same name', async () => {
      const planning = await createFolder(alice, '  Q3 planning ');
      expect(planning.name).toBe('Q3 planning');
      await createFolder(erin, 'Archive');
      expect((await call(alice, 'POST', '/api/folders', { body: { name: 'q3 PLANNING' }, workspace: wsA })).body.code).toBe('FOLDER_NAME_TAKEN');
      // The same name is fine in another workspace.
      await createFolder(bob, 'Q3 planning', wsB);

      const deck = await createPresentation(server, inA(alice), { title: 'Kickoff' });
      const poll = await createPoll(server, inA(alice), { title: 'Lunch' });
      expect((await move(alice, planning.id, [{ entityType: 'presentation', id: deck._id }, { entityType: 'poll', id: poll._id }])).status).toBe(200);

      const list = await call(carol, 'GET', '/api/folders', { workspace: wsA });
      expect(list.status).toBe(200);
      expect(list.body.data.folders.map((folder: { name: string }) => folder.name)).toEqual(['Archive', 'Q3 planning']);
      expect(list.body.data.folders[1]).toMatchObject({ id: planning.id, parentId: null, counts: { presentations: 1, polls: 1 } });

      const renamed = await call(erin, 'PATCH', `/api/folders/${planning.id}`, { body: { name: 'Q4 planning' }, workspace: wsA });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.folder).toMatchObject({ name: 'Q4 planning', counts: { presentations: 1, polls: 1 } });
      expect((await call(erin, 'PATCH', `/api/folders/${planning.id}`, { body: { name: 'archive' }, workspace: wsA })).body.code).toBe(
        'FOLDER_NAME_TAKEN',
      );
      expect((await call(alice, 'PATCH', `/api/folders/${new mongoose.Types.ObjectId()}`, { body: { name: 'x' }, workspace: wsA })).status).toBe(404);
      expect((await call(alice, 'POST', '/api/folders', { body: { name: '' }, workspace: wsA })).status).toBe(400);

      expect((await auditEvent('folder.create')).meta).toMatchObject({ name: expect.any(String) });
      expect((await auditEvent('folder.rename')).meta).toMatchObject({ from: 'Q3 planning', to: 'Q4 planning' });
    });

    it('files decks and polls, filters the library by folder and moves them back without reordering', async () => {
      const folder = await createFolder(alice, 'Workshops');
      const deck = await createPresentation(server, inA(alice), { title: 'Filed deck' });
      const loose = await createPresentation(server, inA(alice), { title: 'Loose deck' });
      const poll = await createPoll(server, inA(alice), { title: 'Filed poll' });
      const before = (await PresentationModel.findById(deck._id).lean())!.updatedAt;

      const moved = await move(erin, folder.id, [
        { entityType: 'presentation', id: deck._id },
        { entityType: 'poll', id: poll._id },
      ]);
      expect(moved.status).toBe(200);
      expect(moved.body.data).toEqual({ folderId: folder.id, moved: { presentations: 1, polls: 1 } });
      expect((await PresentationModel.findById(deck._id).lean())!.updatedAt.getTime()).toBe(before.getTime());

      const inFolder = await library(alice, `?folderId=${folder.id}`);
      expect(inFolder.items.map((item) => item.id).sort()).toEqual([deck._id, poll._id].sort());
      expect(inFolder.items.every((item) => item.folderId === folder.id)).toBe(true);
      expect(inFolder.counts?.all).toBe(2);
      const root = await library(alice, '?folderId=root');
      expect(root.items.map((item) => item.id)).toEqual([loose._id]);
      const all = await library(alice, '');
      expect(all.items).toHaveLength(3);
      expect(all.items.find((item) => item.id === loose._id)!.folderId).toBeNull();

      // Copies land in the same folder.
      const deckCopy = await call(alice, 'POST', `/api/presentations/${deck._id}/duplicate`, { workspace: wsA });
      const pollCopy = await call(alice, 'POST', `/api/polls/${poll._id}/duplicate`, { workspace: wsA });
      expect(String((await PresentationModel.findById(deckCopy.body.data._id).lean())!.folderId)).toBe(folder.id);
      expect(String((await PollModel.findById(pollCopy.body.data._id).lean())!.folderId)).toBe(folder.id);

      expect((await move(alice, null, [{ entityType: 'poll', id: poll._id }])).body.data).toEqual({
        folderId: null,
        moved: { presentations: 0, polls: 1 },
      });
      expect((await PollModel.findById(poll._id).lean())!.folderId).toBeNull();
      expect((await auditEvent('folder.move')).meta).toMatchObject({ folderId: folder.id });
    });

    it('moves nothing when one item is missing or not movable by the caller', async () => {
      const folder = await createFolder(alice, 'Strict');
      const deck = await createPresentation(server, inA(alice));
      const missing = String(new mongoose.Types.ObjectId());
      const res = await move(alice, folder.id, [
        { entityType: 'presentation', id: deck._id },
        { entityType: 'poll', id: missing },
      ]);
      expect(res.status).toBe(404);
      expect((await PresentationModel.findById(deck._id).lean())!.folderId).toBeNull();
      expect((await move(alice, String(new mongoose.Types.ObjectId()), [{ entityType: 'presentation', id: deck._id }])).status).toBe(404);

      // A poll from before workspaces: its creator learns why, anyone else that it does not exist.
      const legacy = await PollModel.create({
        creatorId: alice.id,
        title: 'Before workspaces',
        expiresAt: new Date(Date.now() + 86_400_000),
        questions: [{ text: 'Old?', options: ['Yes', 'No'] }],
      });
      expect((await move(alice, folder.id, [{ entityType: 'poll', id: String(legacy._id) }])).body.code).toBe('NOT_MOVABLE');
      expect((await move(erin, folder.id, [{ entityType: 'poll', id: String(legacy._id) }])).status).toBe(404);
    });

    it('lets viewers see folders but not create, rename, file or delete', async () => {
      const folder = await createFolder(alice, 'Read only');
      const deck = await createPresentation(server, inA(alice));
      expect((await call(carol, 'GET', '/api/folders', { workspace: wsA })).status).toBe(200);
      expect((await call(carol, 'POST', '/api/folders', { body: { name: 'Mine' }, workspace: wsA })).status).toBe(403);
      expect((await call(carol, 'PATCH', `/api/folders/${folder.id}`, { body: { name: 'Mine' }, workspace: wsA })).status).toBe(403);
      expect((await move(carol, folder.id, [{ entityType: 'presentation', id: deck._id }])).status).toBe(403);
      expect((await call(carol, 'DELETE', `/api/folders/${folder.id}`, { workspace: wsA })).status).toBe(403);
      expect(await FolderModel.countDocuments({ workspaceId: wsA })).toBe(1);
    });

    it('a folder share covers the decks in it, and deleting the folder removes its shares and unfiles its items', async () => {
      const folder = await createFolder(alice, 'Shared with Carol');
      const deck = await createPresentation(server, inA(alice), { title: 'Team deck' });
      const poll = await createPoll(server, inA(alice), { title: 'Team poll' });
      await move(alice, folder.id, [{ entityType: 'presentation', id: deck._id }, { entityType: 'poll', id: poll._id }]);

      // Carol (viewer) cannot edit the deck until the folder is shared with her as editor.
      expect((await call(carol, 'PATCH', `/api/presentations/${deck._id}`, { body: { title: 'By Carol' }, workspace: wsA })).status).toBe(403);
      const share = await call(alice, 'PUT', `/api/shares?resourceType=folder&resourceId=${folder.id}`, {
        body: { shares: [{ principalType: 'user', principalId: carol.id, role: 'editor' }] },
        workspace: wsA,
      });
      expect(share.status, JSON.stringify(share.body)).toBe(200);
      expect((await call(carol, 'PATCH', `/api/presentations/${deck._id}`, { body: { title: 'By Carol' }, workspace: wsA })).status).toBe(200);
      // The share also lets her rename the folder, but never delete it or file other items.
      expect((await call(carol, 'PATCH', `/api/folders/${folder.id}`, { body: { name: 'Renamed by Carol' }, workspace: wsA })).status).toBe(200);
      expect((await call(carol, 'DELETE', `/api/folders/${folder.id}`, { workspace: wsA })).status).toBe(403);

      const removed = await call(alice, 'DELETE', `/api/folders/${folder.id}`, { workspace: wsA });
      expect(removed.status).toBe(200);
      expect(removed.body.data).toMatchObject({ moved: { presentations: 1, polls: 1 }, sharesRemoved: 1 });
      expect(await ResourceShareModel.countDocuments({ resourceType: 'folder', resourceId: folder.id })).toBe(0);
      expect(await FolderModel.countDocuments({ _id: folder.id })).toBe(0);
      expect((await PresentationModel.findById(deck._id).lean())!.folderId).toBeNull();
      expect((await PollModel.findById(poll._id).lean())!.folderId).toBeNull();
      expect((await call(carol, 'PATCH', `/api/presentations/${deck._id}`, { body: { title: 'Again' }, workspace: wsA })).status).toBe(403);
      expect((await call(alice, 'GET', `/api/shares?resourceType=folder&resourceId=${folder.id}`, { workspace: wsA })).status).toBe(404);
      expect((await auditEvent('folder.delete')).meta).toMatchObject({ sharesRemoved: 1 });
    });

    it('keeps folders inside their workspace', async () => {
      const folderA = await createFolder(alice, 'Alpha only');
      const folderB = await createFolder(bob, 'Beta only', wsB);
      const deckA = await createPresentation(server, inA(alice));
      const deckB = await createPresentation(server, inB(bob));
      for (const workspace of [wsB, undefined]) {
        const list = await call(bob, 'GET', '/api/folders', { workspace });
        expect(JSON.stringify(list.body)).not.toContain(folderA.id);
        expect([403, 404]).toContain((await call(bob, 'PATCH', `/api/folders/${folderA.id}`, { body: { name: 'x' }, workspace })).status);
        expect([403, 404]).toContain((await call(bob, 'DELETE', `/api/folders/${folderA.id}`, { workspace })).status);
        expect([403, 404]).toContain((await move(bob, folderA.id, [{ entityType: 'presentation', id: deckB._id }], workspace as string)).status);
        expect([403, 404]).toContain((await move(bob, folderB.id, [{ entityType: 'presentation', id: deckA._id }], workspace as string)).status);
        expect([403, 404]).toContain((await move(bob, null, [{ entityType: 'presentation', id: deckA._id }], workspace as string)).status);
      }
      expect((await call(bob, 'GET', '/api/folders', { workspace: wsA })).body.code).toBe('WORKSPACE_FORBIDDEN');
      expect((await FolderModel.findById(folderA.id).lean())!.name).toBe('Alpha only');
      expect((await PresentationModel.findById(deckA._id).lean())!.folderId).toBeNull();
      expect((await PresentationModel.findById(deckB._id).lean())!.folderId).toBeNull();
    });

    it('migration 210 creates the folder and poll indexes and can run twice', async () => {
      const db = mongoose.connection.db!;
      const logs: string[] = [];
      await migration210.up({ db, connection: mongoose.connection, log: (line: string) => logs.push(line) } as never);
      await migration210.up({ db, connection: mongoose.connection, log: () => {} } as never);
      const folderIndexes = await db.collection('folders').indexes();
      expect(folderIndexes.find((index) => index.name === 'folder_name_per_parent')).toMatchObject({ unique: true });
      const pollIndexes = await db.collection('polls').indexes();
      expect(pollIndexes.some((index) => index.name === 'polls_workspace_folder_updated')).toBe(true);
      expect(logs.join('\n')).toContain('polls_workspace_folder_updated');
    });
  });

  describe('templates', () => {
    it('lists the starter templates and makes a draft deck from one', async () => {
      const list = await call(carol, 'GET', '/api/templates', { workspace: wsA });
      expect(list.status).toBe(200);
      expect(list.body.data.starter.map((template: { id: string }) => template.id)).toEqual([
        'team-retro',
        'conference-talk',
        'classroom-quiz',
        'all-hands-pulse',
      ]);
      expect(list.body.data.starter[2]).toMatchObject({ source: 'starter', category: 'Education', slideCount: 10 });
      expect(list.body.data.workspace).toEqual([]);

      const used = await call(erin, 'POST', '/api/templates/conference-talk/use', { workspace: wsA });
      expect(used.status, JSON.stringify(used.body)).toBe(201);
      const deck = await PresentationModel.findById(used.body.data._id).lean();
      expect(deck).toMatchObject({ title: 'Conference talk', status: 'draft', isTemplate: false, creatorId: erin.id });
      expect(String(deck!.workspaceId)).toBe(wsA);
      expect(deck!.slides.map((slide) => slide.type)).toContain('qna');
      expect(deck!.settings.qna.enabled).toBe(true);
      expect((await library(alice, '')).items.map((item) => item.id)).toContain(used.body.data._id);

      const named = await call(alice, 'POST', '/api/templates/team-retro/use', { body: { title: 'Sprint 42 retro' }, workspace: wsA });
      expect(named.body.data.title).toBe('Sprint 42 retro');
      expect((await call(alice, 'POST', '/api/templates/unknown-template/use', { workspace: wsA })).status).toBe(404);
      expect((await call(carol, 'POST', '/api/templates/team-retro/use', { workspace: wsA })).status).toBe(403);
    });

    it('saves a deck as a workspace template that stays out of the library, and uses and deletes it', async () => {
      const source = await createPresentation(server, inA(alice), {
        title: 'Weekly sync',
        slides: [
          { type: 'heading', content: { title: 'Weekly sync' } },
          { type: 'wordcloud', question: 'How was your week?', timeLimit: 0 },
        ],
      });
      const saved = await call(erin, 'POST', '/api/templates', { body: { presentationId: source._id, title: 'Sync template' }, workspace: wsA });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      const templateId = saved.body.data._id as string;
      expect(await PresentationModel.findById(templateId).lean()).toMatchObject({ isTemplate: true, title: 'Sync template' });
      expect(String((await PresentationModel.findById(templateId).lean())!.templateSourceId)).toBe(source._id);

      // Hidden from the library, its counts and the deck list.
      const lib = await library(alice, '');
      expect(lib.items.map((item) => item.id)).not.toContain(templateId);
      expect(lib.counts?.all).toBe(1);
      const decks = await call(alice, 'GET', '/api/presentations', { workspace: wsA });
      expect(JSON.stringify(decks.body.data)).not.toContain(templateId);

      const list = await call(carol, 'GET', '/api/templates', { workspace: wsA });
      expect(list.body.data.workspace).toEqual([
        expect.objectContaining({ id: templateId, source: 'workspace', title: 'Sync template', slideCount: 2, createdBy: { id: erin.id, name: 'Erin' } }),
      ]);
      expect(list.body.data.workspace[0].outline).toEqual(['Weekly sync', 'How was your week?']);

      const used = await call(alice, 'POST', `/api/templates/${templateId}/use`, { workspace: wsA });
      expect(used.status).toBe(201);
      const deck = await PresentationModel.findById(used.body.data._id).lean();
      expect(deck).toMatchObject({ title: 'Sync template', isTemplate: false, status: 'draft' });
      expect(String(deck!.templateSourceId)).toBe(templateId);
      expect(deck!.slides.map((slide) => slide.type)).toEqual(['heading', 'wordcloud']);

      // A template is not a deck for these routes, and not saved twice.
      expect((await call(alice, 'POST', `/api/templates/${source._id}/use`, { workspace: wsA })).status).toBe(404);
      expect((await call(alice, 'POST', '/api/templates', { body: { presentationId: templateId }, workspace: wsA })).body.code).toBe('ALREADY_A_TEMPLATE');
      expect((await call(alice, 'DELETE', `/api/templates/${source._id}`, { workspace: wsA })).status).toBe(404);
      expect((await call(carol, 'DELETE', `/api/templates/${templateId}`, { workspace: wsA })).status).toBe(403);

      expect((await call(alice, 'DELETE', `/api/templates/${templateId}`, { workspace: wsA })).status).toBe(200);
      expect(await PresentationModel.countDocuments({ _id: templateId })).toBe(0);
      expect(await PresentationModel.countDocuments({ _id: used.body.data._id })).toBe(1);
      expect((await auditEvent('template.create')).meta).toMatchObject({ sourceId: source._id });
      await auditEvent('template.use');
      await auditEvent('template.delete');
    });

    it('keeps workspace templates inside their workspace', async () => {
      const source = await createPresentation(server, inA(alice), { title: 'Alpha secret' });
      const templateId = (await call(alice, 'POST', '/api/templates', { body: { presentationId: source._id }, workspace: wsA })).body.data._id;
      for (const workspace of [wsB, undefined]) {
        const list = await call(bob, 'GET', '/api/templates', { workspace });
        expect(list.status).toBe(200);
        expect(JSON.stringify(list.body)).not.toContain(templateId);
        expect(JSON.stringify(list.body)).not.toContain('Alpha secret');
        expect([403, 404]).toContain((await call(bob, 'POST', `/api/templates/${templateId}/use`, { workspace })).status);
        expect([403, 404]).toContain((await call(bob, 'DELETE', `/api/templates/${templateId}`, { workspace })).status);
        expect([403, 404]).toContain((await call(bob, 'POST', '/api/templates', { body: { presentationId: source._id }, workspace })).status);
      }
      expect(await PresentationModel.countDocuments({})).toBe(2);
    });
  });
});
