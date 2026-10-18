import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { PollModel } from '../../src/modules/polls/polls.model';
import {
  PresentationAnswerModel,
  PresentationModel,
  PresentationParticipantModel,
} from '../../src/modules/presentations/presentations.model';
import { ResponseModel } from '../../src/modules/responses/responses.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { ensurePersonalWorkspace } from '../../src/modules/workspaces/provisioning';
import { UserModel } from '../../src/modules/auth/auth.model';
import { createPoll, createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** W1-C: GET /api/library and POST /api/library/convert/poll/:pollId through the real app. */

type Card = {
  entityType: 'poll' | 'presentation';
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  stats: Record<string, number>;
  details: Record<string, any>;
};
type Page = { items: Card[]; nextCursor: string | null; counts?: Record<string, number> };

describeIntegration('library over HTTP', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
    await resetTestData();
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  const json = async <T>(res: Response) => ((await res.json()) as { data: T; message: string; code?: string });

  const list = async (user: TestUser, query = '', headers: Record<string, string> = {}) => {
    const res = await server.request(`/api/library${query}`, { headers: { ...user.headers, ...headers } });
    expect(res.status).toBe(200);
    return (await json<Page>(res)).data;
  };

  const convert = (user: TestUser, pollId: string, query = '') =>
    server.request(`/api/library/convert/poll/${pollId}${query}`, { method: 'POST', headers: user.headers });

  /** Workspace ids are ObjectIds; written raw, as migration 020 / W1-B will. */
  const moveTo = async (collection: 'polls' | 'presentations', id: string, workspaceId: mongoose.Types.ObjectId) => {
    await mongoose.connection.db!.collection(collection).updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { workspaceId } },
    );
  };

  describe('GET /api/library', () => {
    let owner: TestUser;
    const created: { id: string; entityType: Card['entityType'] }[] = [];

    beforeAll(async () => {
      owner = await createVerifiedUser();
      // Alternate polls and decks so the merge has to interleave the collections.
      const steps: Array<() => Promise<{ _id: string }>> = [
        () => createPoll(server, owner, { title: 'Lunch vote' }),
        () => createPresentation(server, owner, { title: 'Kickoff deck' }),
        () => createPoll(server, owner, { title: 'C++ (beta) feedback', isPublished: false }),
        () => createPresentation(server, owner, { title: 'c++ (BETA) quiz' }),
        () => createPoll(server, owner, { title: 'Retro poll' }),
        () => createPresentation(server, owner, { title: 'All hands' }),
      ];
      for (const [index, step] of steps.entries()) {
        const doc = await step();
        created.push({ id: doc._id, entityType: index % 2 === 0 ? 'poll' : 'presentation' });
        await Bun.sleep(5);
      }
    });

    it('requires authentication', async () => {
      expect((await server.request('/api/library')).status).toBe(401);
    });

    it('lists polls and decks together, newest first, with counts', async () => {
      const page = await list(owner);
      expect(page.items.map((item) => item.id)).toEqual(created.map((item) => item.id).reverse());
      expect(page.items.map((item) => item.entityType)).toEqual(created.map((item) => item.entityType).reverse());
      expect(page.nextCursor).toBeNull();
      expect(page.counts).toEqual({ all: 6, poll: 3, presentation: 3, live: 2, draft: 4 });

      const poll = page.items.find((item) => item.title === 'Lunch vote')!;
      expect(poll).toMatchObject({
        entityType: 'poll',
        status: 'live',
        stats: { questionCount: 1, responseCount: 0 },
        details: { pollType: 'POLL', convertedPresentationId: null },
      });
      const deck = page.items.find((item) => item.title === 'Kickoff deck')!;
      expect(deck).toMatchObject({
        entityType: 'presentation',
        status: 'draft',
        stats: { slideCount: 1 },
        details: { phase: 'draft', pace: 'presenter', legacySource: null, slideTypes: ['select_answer'] },
      });
      expect(deck.details.joinCode).toMatch(/^\d{6}$/);
    });

    it('pages with a cursor without skipping or repeating items', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: Page = await list(owner, `?limit=4${cursor ? `&cursor=${cursor}` : ''}`);
        if (pages > 0) expect(page.counts).toBeUndefined();
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(2);
      expect(seen).toEqual(created.map((item) => item.id).reverse());

      // Ties on updatedAt fall back to the id order.
      const tie = new Date('2026-01-01T00:00:00.000Z');
      await mongoose.connection.db!.collection('polls').updateMany({ creatorId: owner.id }, { $set: { updatedAt: tie } });
      await mongoose.connection.db!.collection('presentations').updateMany({ creatorId: owner.id }, { $set: { updatedAt: tie } });
      const tied: string[] = [];
      cursor = null;
      do {
        const page: Page = await list(owner, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        tied.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor && tied.length < 10);
      expect(tied).toEqual([...created.map((item) => item.id)].sort().reverse());
    });

    it('filters by type and status; counts ignore those filters', async () => {
      const polls = await list(owner, '?type=poll');
      expect(polls.items.every((item) => item.entityType === 'poll')).toBe(true);
      expect(polls.items).toHaveLength(3);
      expect(polls.counts?.all).toBe(6);

      const decks = await list(owner, '?type=presentation');
      expect(decks.items.map((item) => item.entityType)).toEqual(['presentation', 'presentation', 'presentation']);

      const drafts = await list(owner, '?status=draft');
      expect(drafts.items.map((item) => item.title).sort()).toEqual(
        ['All hands', 'C++ (beta) feedback', 'Kickoff deck', 'c++ (BETA) quiz'].sort(),
      );
      const live = await list(owner, '?status=live');
      expect(live.items.map((item) => item.title).sort()).toEqual(['Lunch vote', 'Retro poll']);
    });

    it('counts a deck with an open lobby as live', async () => {
      const deck = created.find((item) => item.entityType === 'presentation')!;
      const res = await server.request(`/api/presentations/${deck.id}/host/open-lobby`, { method: 'POST', headers: owner.headers });
      expect(res.status).toBe(200);
      const page = await list(owner, '?type=presentation&status=live');
      expect(page.items.map((item) => item.id)).toEqual([deck.id]);
      expect(page.items[0]!.details.phase).toBe('lobby');
      expect(page.counts?.live).toBe(3);
    });

    it('searches titles case-insensitively and literally', async () => {
      const page = await list(owner, `?q=${encodeURIComponent('C++ (BETA)')}`);
      expect(page.items.map((item) => item.title).sort()).toEqual(['C++ (beta) feedback', 'c++ (BETA) quiz']);
      expect(page.counts).toMatchObject({ all: 2, poll: 1, presentation: 1 });
      expect((await list(owner, `?q=${encodeURIComponent('.*')}`)).items).toHaveLength(0);
    });

    it('filters by folder (root = outside any folder)', async () => {
      expect((await list(owner, '?folderId=root')).items).toHaveLength(6);
      expect((await list(owner, `?folderId=${new mongoose.Types.ObjectId().toString()}`)).items).toHaveLength(0);
    });

    it('rejects malformed queries', async () => {
      for (const query of ['?type=quiz', '?cursor=nope', '?limit=0', '?folderId=xyz']) {
        const res = await server.request(`/api/library${query}`, { headers: owner.headers });
        expect(res.status).toBe(400);
      }
    });

    it('never shows another user’s items', async () => {
      const stranger = await createVerifiedUser();
      const page = await list(stranger);
      expect(page.items).toEqual([]);
      expect(page.counts).toEqual({ all: 0, poll: 0, presentation: 0, live: 0, draft: 0 });
    });

    it('scopes to the current workspace (X-Workspace-Id)', async () => {
      const editor = await createVerifiedUser();
      const viewer = await createVerifiedUser();
      const outsider = await createVerifiedUser();
      const team = await WorkspaceModel.create({
        name: 'Team',
        slug: `team-${new mongoose.Types.ObjectId().toString()}`,
        type: 'team',
        ownerId: editor.id,
      });
      await WorkspaceMemberModel.create({ workspaceId: team._id, userId: editor.id, role: 'editor' });
      await WorkspaceMemberModel.create({ workspaceId: team._id, userId: viewer.id, role: 'viewer' });

      const teamPoll = await createPoll(server, editor, { title: 'Team poll' });
      const teamDeck = await createPresentation(server, editor, { title: 'Team deck' });
      const personalPoll = await createPoll(server, editor, { title: 'Personal poll' });
      await moveTo('polls', teamPoll._id, team._id);
      await moveTo('presentations', teamDeck._id, team._id);

      const inTeam = { 'X-Workspace-Id': String(team._id) };
      const forEditor = await list(editor, '', inTeam);
      expect(forEditor.items.map((item) => item.title).sort()).toEqual(['Team deck', 'Team poll']);
      const forViewer = await list(viewer, '', inTeam);
      expect(forViewer.items.map((item) => item.title).sort()).toEqual(['Team deck', 'Team poll']);

      // The personal workspace holds the editor's own items without a workspace yet.
      const personal = await list(editor);
      expect(personal.items.map((item) => item.title)).toEqual(['Personal poll']);
      expect(personal.items[0]!.id).toBe(personalPoll._id);

      const denied = await server.request('/api/library', { headers: { ...outsider.headers, ...inTeam } });
      expect(denied.status).toBe(403);
      expect((await json(denied)).code).toBe('WORKSPACE_FORBIDDEN');
    });

    it('lists items of the personal workspace once they carry its id', async () => {
      const user = await createVerifiedUser();
      const poll = await createPoll(server, user, { title: 'Backfilled' });
      const { workspace } = await ensurePersonalWorkspace((await UserModel.findById(user.id))!);
      await moveTo('polls', poll._id, workspace._id);
      expect((await list(user)).items.map((item) => item.id)).toEqual([poll._id]);
    });
  });

  describe('POST /api/library/convert/poll/:pollId', () => {
    let owner: TestUser;

    beforeAll(async () => {
      owner = await createVerifiedUser();
    });

    it('converts a POLL into an audience-paced deck of select_answer slides', async () => {
      const poll = await createPoll(server, owner, {
        title: 'Team survey',
        questions: [
          { text: 'Best runtime?', options: ['Bun', 'Node', 'Deno'], type: 'single' },
          { text: 'Which do you use?', options: ['TS', 'JS'], type: 'multiple', explanation: 'Pick all' },
        ],
      });
      const pollBefore = await PollModel.collection.findOne({ _id: new mongoose.Types.ObjectId(poll._id) });

      const res = await convert(owner, poll._id);
      expect(res.status).toBe(201);
      const { created, presentation } = (await json<{ created: boolean; presentation: any }>(res)).data;
      expect(created).toBe(true);
      expect(presentation).toMatchObject({
        title: 'Team survey',
        status: 'draft',
        creatorId: owner.id,
        pace: 'audience',
        legacy: { source: 'poll', sourceId: poll._id },
      });
      // Deck settings are all defaulted since the session engine (W1-A1): a POLL leaves assessment off.
      expect(presentation.settings.audiencePaced.assessment.enabled).toBe(false);
      expect(presentation.slides).toHaveLength(2);
      expect(presentation.slides[0]).toMatchObject({
        type: 'select_answer',
        kind: 'interactive',
        question: 'Best runtime?',
        options: [
          { text: 'Bun', isCorrect: false },
          { text: 'Node', isCorrect: false },
          { text: 'Deno', isCorrect: false },
        ],
        points: 0,
        scoreDependsOnTime: false,
        config: { allowMultiple: false, explanation: '' },
      });
      expect(presentation.slides[1].config).toEqual({ allowMultiple: true, explanation: 'Pick all' });

      const { workspace } = await ensurePersonalWorkspace((await UserModel.findById(owner.id))!);
      const stored = await PresentationModel.collection.findOne({ _id: new mongoose.Types.ObjectId(presentation._id) });
      expect(String(stored!.workspaceId)).toBe(String(workspace._id));

      const pollAfter = await PollModel.collection.findOne({ _id: new mongoose.Types.ObjectId(poll._id) });
      expect(String(pollAfter!.convertedPresentationId)).toBe(presentation._id);
      expect(pollAfter!.updatedAt).toEqual(pollBefore!.updatedAt);

      // The library shows both, linked.
      const page = await list(owner);
      expect(page.items.find((item) => item.id === poll._id)!.details.convertedPresentationId).toBe(presentation._id);
      expect(page.items.find((item) => item.id === presentation._id)!.details).toMatchObject({
        pace: 'audience',
        legacySource: 'poll',
      });

      // The deck builder can load and save it unchanged.
      const loaded = await server.request(`/api/presentations/${presentation._id}`, { headers: owner.headers });
      expect(loaded.status).toBe(200);
      const deck = (await json<any>(loaded)).data;
      const saved = await server.request(`/api/presentations/${presentation._id}`, {
        method: 'PATCH',
        headers: owner.headers,
        body: { title: deck.title, slides: deck.slides },
      });
      expect(saved.status).toBe(200);
      expect((await json<any>(saved)).data.slides[1].config).toEqual({ allowMultiple: true, explanation: 'Pick all' });
    });

    it('maps a TRIAL: answer key, points, explanations and the assessment settings', async () => {
      const trial = await createPoll(server, owner, {
        title: 'Safety check',
        pollType: 'TRIAL',
        passingScorePercentage: 80,
        questions: [
          { text: 'Exit route?', options: ['Stairs', 'Lift'], type: 'single', correctOptionIndices: [0], points: 3, explanation: 'Never the lift.' },
          { text: 'Extinguishers?', options: ['CO2', 'Water', 'Foam'], type: 'multiple', correctOptionIndices: [0, 2], points: 2 },
        ],
      });
      const res = await convert(owner, trial._id);
      expect(res.status).toBe(201);
      const { presentation } = (await json<{ presentation: any }>(res)).data;
      expect(presentation.pace).toBe('audience');
      expect(presentation.settings.audiencePaced.assessment).toEqual({
        enabled: true,
        passingScorePercentage: 80,
        maxAttempts: null,
      });
      expect(presentation.slides[0]).toMatchObject({
        options: [
          { text: 'Stairs', isCorrect: true },
          { text: 'Lift', isCorrect: false },
        ],
        points: 3,
        scoreDependsOnTime: false,
        config: { allowMultiple: false, explanation: 'Never the lift.' },
      });
      expect(presentation.slides[1]).toMatchObject({
        options: [
          { text: 'CO2', isCorrect: true },
          { text: 'Water', isCorrect: false },
          { text: 'Foam', isCorrect: true },
        ],
        points: 2,
        config: { allowMultiple: true },
      });
    });

    it('is idempotent per poll unless forced, and survives a deleted deck', async () => {
      const poll = await createPoll(server, owner, { title: 'Once' });
      const first = (await json<{ presentation: any }>(await convert(owner, poll._id))).data.presentation;

      const again = await convert(owner, poll._id);
      expect(again.status).toBe(200);
      const repeat = (await json<{ created: boolean; presentation: any }>(again)).data;
      expect(repeat.created).toBe(false);
      expect(repeat.presentation._id).toBe(first._id);

      const forced = await convert(owner, poll._id, '?force=true');
      expect(forced.status).toBe(201);
      const fresh = (await json<{ presentation: any }>(forced)).data.presentation;
      expect(fresh._id).not.toBe(first._id);
      expect(String((await PollModel.findById(poll._id).lean())!.convertedPresentationId)).toBe(fresh._id);
      expect(await PresentationModel.exists({ _id: first._id })).not.toBeNull();

      await server.request(`/api/presentations/${fresh._id}`, { method: 'DELETE', headers: owner.headers });
      const afterDelete = await convert(owner, poll._id);
      expect(afterDelete.status).toBe(201);
      const replacement = (await json<{ presentation: any }>(afterDelete)).data.presentation;
      expect([first._id, fresh._id]).not.toContain(replacement._id);
    });

    it('creates exactly one deck when conversions race', async () => {
      const racer = await createVerifiedUser();
      const poll = await createPoll(server, racer, { title: 'Race' });
      const results = await Promise.all(Array.from({ length: 6 }, () => convert(racer, poll._id)));
      const bodies = await Promise.all(results.map((res) => json<{ created: boolean; presentation: any }>(res)));
      expect(results.every((res) => res.status === 200 || res.status === 201)).toBe(true);
      expect(new Set(bodies.map((body) => body.data.presentation._id)).size).toBe(1);
      expect(bodies.filter((body) => body.data.created)).toHaveLength(1);
      expect(await PresentationModel.countDocuments({ 'legacy.sourceId': new mongoose.Types.ObjectId(poll._id) })).toBe(1);
    });

    it('copies questions only: responses stay with the poll, which keeps working', async () => {
      const poll = await createPoll(server, owner, { title: 'With votes' });
      const vote = async () => {
        const ballot = await server.request(`/api/responses/poll/${poll._id}/ballot`, { method: 'POST' });
        expect(ballot.status).toBe(200);
        const { ballotToken } = (await json<{ ballotToken: string }>(ballot)).data;
        return server.request('/api/responses', {
          method: 'POST',
          body: { pollId: poll._id, ballotToken, answers: [{ questionId: poll.questions[0]._id, selectedOptionIndex: 0 }] },
        });
      };
      expect((await vote()).status).toBe(201);

      const { presentation } = (await json<{ presentation: any }>(await convert(owner, poll._id))).data;
      expect(await PresentationParticipantModel.countDocuments({ presentationId: presentation._id })).toBe(0);
      expect(await PresentationAnswerModel.countDocuments({ presentationId: presentation._id })).toBe(0);

      // /p/[id], analytics and voting are untouched by the conversion.
      const publicPoll = await server.request(`/api/polls/${poll._id}`);
      expect(publicPoll.status).toBe(200);
      expect((await json<any>(publicPoll)).data.questions).toHaveLength(1);
      expect((await server.request(`/api/responses/poll/${poll._id}/summary`)).status).toBe(200);
      expect((await vote()).status).toBe(201);
      expect(await ResponseModel.countDocuments({ pollId: poll._id })).toBe(2);
    });

    it('plays live: an ungraded single and a multi-select slide take answers', async () => {
      const poll = await createPoll(server, owner, {
        title: 'Live survey',
        questions: [
          { text: 'Tea or coffee?', options: ['Tea', 'Coffee'], type: 'single' },
          { text: 'Snacks?', options: ['Fruit', 'Cake', 'Nuts'], type: 'multiple' },
        ],
      });
      const { presentation } = (await json<{ presentation: any }>(await convert(owner, poll._id))).data;
      const host = (path: string, body?: unknown) =>
        server.request(`/api/presentations/${presentation._id}/host/${path}`, { method: 'POST', headers: owner.headers, body });

      expect((await host('open-lobby')).status).toBe(200);
      const joined = await server.request(`/api/presentations/${presentation._id}/join`, { method: 'POST', body: { name: 'Ada' } });
      expect(joined.status).toBe(200);
      const ada = (await json<{ participantId: string; token: string }>(joined)).data;
      const answer = (slideIndex: number, body: Record<string, unknown>) =>
        server.request(`/api/presentations/${presentation._id}/answer`, {
          method: 'POST',
          body: { participantId: ada.participantId, participantToken: ada.token, slideIndex, ...body },
        });

      expect((await host('advance')).status).toBe(200);
      expect((await answer(0, { optionIndex: 1 })).status).toBe(200);

      expect((await host('advance')).status).toBe(200);
      const code = await server.request(`/api/presentations/code/${presentation.joinCode}`);
      expect((await json<any>(code)).data.currentSlide).toMatchObject({ allowMultiple: true });
      expect((await answer(1, { payload: { optionIndices: [2, 0] } })).status).toBe(200);
      expect((await answer(1, { payload: { optionIndices: [1] } })).status).toBe(409);

      const state = await server.request(`/api/presentations/${presentation._id}/host/state`, { headers: owner.headers });
      expect((await json<any>(state)).data.liveDistribution).toMatchObject({ kind: 'options', counts: [1, 0, 1] });
    });

    it('enforces access and reports missing polls', async () => {
      const poll = await createPoll(server, owner, { title: 'Mine' });
      const stranger = await createVerifiedUser();
      const denied = await convert(stranger, poll._id);
      expect(denied.status).toBe(403);
      expect((await json(denied)).code).toBe('FORBIDDEN');
      expect((await PollModel.findById(poll._id).lean())!.convertedPresentationId).toBeNull();

      expect((await convert(owner, new mongoose.Types.ObjectId().toString())).status).toBe(404);
      expect((await convert(owner, 'not-an-id')).status).toBe(400);
      expect(
        (await server.request(`/api/library/convert/poll/${poll._id}`, { method: 'POST' })).status,
      ).toBe(401);
    });

    it('refuses polls a deck cannot represent', async () => {
      const poll = await createPoll(server, owner, {
        title: 'Huge',
        questions: [{ text: 'Pick a number', options: Array.from({ length: 9 }, (_, i) => String(i)), type: 'single' }],
      });
      const res = await convert(owner, poll._id);
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.code).toBe('POLL_NOT_CONVERTIBLE');
      expect(body.message).toContain('question 1');
      expect(await PresentationModel.countDocuments({ 'legacy.sourceId': new mongoose.Types.ObjectId(poll._id) })).toBe(0);
    });
  });
});
