import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { setStorageDriver, type StorageDriver } from '../../src/common/storage/storage';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { PollModel } from '../../src/modules/polls/polls.model';
import {
  PresentationAnswerModel,
  PresentationModel,
  PresentationParticipantModel,
  PresentationSessionModel,
} from '../../src/modules/presentations/presentations.model';
import { AnalyticsModel } from '../../src/modules/responses/analytics.model';
import { ResponseModel } from '../../src/modules/responses/responses.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { createPoll, createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, settleLiveEngine, startTestServer, type TestServer } from './harness';

/**
 * POST /api/presentations/:id/duplicate and POST /api/polls/:id/duplicate
 * through the real app: what a copy keeps and drops, that runs, answers and
 * responses stay with the original, and who may duplicate what (the source's
 * workspace only, `deck:read` on it plus `deck:create` there).
 */

type Body<T = any> = { success: boolean; message: string; code?: string; data: T };

const DAY = 24 * 60 * 60 * 1000;

const KIT = {
  name: 'Acme',
  colors: {
    background: '#0a1f44',
    surface: '#13295a',
    text: '#ffffff',
    mutedText: '#b8c4dc',
    accent: '#ffcc00',
    accentText: '#1a1400',
    correct: '#4ade80',
    incorrect: '#fb7185',
    chart: ['#FFCC00', '#38bdf8'],
  },
  fonts: { heading: 'Montserrat', body: 'Inter' },
  logo: { url: 'https://cdn.example.com/acme.png', alt: 'Acme' },
};

/** Uploads land "in S3" without a network: presign, then complete reads the object's size and type. */
const fakeStorage: StorageDriver = {
  enabled: true,
  presignPut: async (key) => ({ key, url: `https://s3.test/${key}`, method: 'PUT', headers: {}, expiresAt: new Date(Date.now() + 60_000) }),
  publicUrl: (key) => `https://cdn.test/${key}`,
  stat: async (key) => ({ key, size: 100, type: 'image/png' }),
  getObject: async () => {
    throw new Error('unused');
  },
  putObject: async () => {},
  delete: async () => {},
};

/** A slide or question as the client sees it, without the ids a copy must renew. */
const withoutIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_id').map(([key, child]) => [key, withoutIds(child)]));
  }
  return value;
};

describeIntegration('duplicate decks and polls over HTTP', () => {
  let server: TestServer;
  let previousStorage: StorageDriver;
  let alice!: TestUser; // owner of Alpha
  let erin!: TestUser; // editor in Alpha
  let dana!: TestUser; // presenter in Alpha
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
  const inWorkspace = (user: TestUser, workspaceId: string): TestUser => ({
    ...user,
    headers: { ...user.headers, 'x-workspace-id': workspaceId } as TestUser['headers'],
  });
  const duplicateDeck = (user: TestUser | null, id: string, workspace?: string) =>
    call(user, 'POST', `/api/presentations/${id}/duplicate`, { workspace });
  const duplicatePoll = (user: TestUser | null, id: string, workspace?: string) =>
    call(user, 'POST', `/api/polls/${id}/duplicate`, { workspace });

  /** Audit events are written fire-and-forget. */
  const auditEvent = async (action: string, targetId: string) => {
    for (let i = 0; i < 50; i++) {
      const event = await AuditEventModel.findOne({ action, targetId }).lean();
      if (event) return event;
      await Bun.sleep(20);
    }
    throw new Error(`No ${action} audit event for ${targetId}`);
  };

  beforeAll(async () => {
    server = await startTestServer();
    previousStorage = setStorageDriver(fakeStorage);
  }, 20_000);

  afterAll(async () => {
    setStorageDriver(previousStorage);
    await server?.close();
  });

  beforeEach(async () => {
    await resetTestData();
    [alice, erin, dana, carol, bob] = await Promise.all([
      createVerifiedUser({ name: 'Alice' }),
      createVerifiedUser({ name: 'Erin' }),
      createVerifiedUser({ name: 'Dana' }),
      createVerifiedUser({ name: 'Carol' }),
      createVerifiedUser({ name: 'Bob' }),
    ]);
    wsA = (await call(alice, 'POST', '/api/workspaces', { body: { name: 'Alpha' } })).body.data.workspace._id;
    wsB = (await call(bob, 'POST', '/api/workspaces', { body: { name: 'Beta' } })).body.data.workspace._id;
    await WorkspaceModel.updateMany({ _id: { $in: [wsA, wsB] } }, { $set: { plan: 'team' } });
    await WorkspaceMemberModel.create([
      { workspaceId: wsA, userId: erin.id, role: 'editor' },
      { workspaceId: wsA, userId: dana.id, role: 'presenter' },
      { workspaceId: wsA, userId: carol.id, role: 'viewer' },
    ]);
  });

  describe('POST /api/presentations/:id/duplicate', () => {
    it('copies every slide (new ids), notes, media, pace, settings and theme into a draft with its own join code', async () => {
      const presign = await call(alice, 'POST', '/api/uploads/presign', {
        workspace: wsA,
        body: { purpose: 'slide_image', mime: 'image/png', bytes: 100 },
      });
      const key: string = presign.body.data.key;
      expect((await call(alice, 'POST', '/api/uploads/complete', { workspace: wsA, body: { key } })).status).toBe(201);
      const kit = await call(alice, 'POST', '/api/brand-kits', { workspace: wsA, body: KIT });
      expect(kit.status).toBe(201);

      const created = await call(alice, 'POST', '/api/presentations', {
        workspace: wsA,
        body: {
          title: 'Quarterly kickoff',
          pace: 'audience',
          slides: [
            {
              type: 'select_answer',
              question: 'Which plan wins?',
              notes: 'Pause here for questions',
              options: [
                { text: 'Plan A', isCorrect: true },
                { text: 'Plan B', isCorrect: false },
              ],
              timeLimit: 45,
              points: 500,
              config: { allowMultiple: true, explanation: 'A ships first' },
            },
            { type: 'image', notes: 'Show the chart', content: { key, alt: 'Revenue chart', fit: 'cover', caption: 'Q3' } },
          ],
          settings: {
            nickname: 'optional',
            qna: { enabled: true, moderation: true },
            reactions: { enabled: true, emojis: ['🎉', '👍'] },
            audiencePaced: { resultsVisibility: 'after_submit' },
          },
          theme: { presetId: 'ocean', brandKitId: kit.body.data.id, overrides: { accent: '#0a1f44', accentText: '#ffffff' } },
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const source = created.body.data;
      const folderId = new mongoose.Types.ObjectId();
      await PresentationModel.updateOne({ _id: source._id }, { $set: { folderId } });
      const before = (await PresentationModel.findById(source._id))!.toObject();

      const res = await duplicateDeck(erin, source._id, wsA);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.message).toBe('Presentation duplicated successfully');
      const copy = res.body.data;

      // Same shape as create: the stored document.
      expect(Object.keys(copy).sort()).toEqual(Object.keys(source).sort());
      expect(copy).toMatchObject({
        title: 'Copy of Quarterly kickoff',
        status: 'draft',
        pace: 'audience',
        creatorId: erin.id,
        workspaceId: wsA,
        folderId: String(folderId),
        currentSlideIndex: -1,
        activeSessionId: null,
        lastSessionAt: null,
        sessionCount: 0,
        legacy: null,
        deletedAt: null,
      });
      expect(copy._id).not.toBe(source._id);
      expect(copy.joinCode).toMatch(/^\d{6}$/);
      expect(copy.joinCode).not.toBe(source.joinCode);

      // Slides: same content and order, fresh ids on slides and options.
      expect(withoutIds(copy.slides)).toEqual(withoutIds(source.slides));
      expect(copy.slides.map((slide: any) => slide.notes)).toEqual(['Pause here for questions', 'Show the chart']);
      expect(copy.slides[1].content).toMatchObject({ key, url: `https://cdn.test/${key}`, alt: 'Revenue chart' });
      const sourceIds = new Set([...source.slides, ...source.slides[0].options].map((item: any) => item._id));
      for (const item of [...copy.slides, ...copy.slides[0].options]) {
        expect(item._id).toBeString();
        expect(sourceIds.has(item._id)).toBe(false);
      }
      expect(copy.settings).toEqual(source.settings);
      // Light (the source was created without a mode) and the same look; the resolved tokens come along.
      expect(copy.theme).toEqual({
        presetId: 'ocean',
        mode: 'light',
        brandKitId: kit.body.data.id,
        overrides: { accent: '#0a1f44', accentText: '#ffffff' },
      });
      expect(copy.themeTokens).toMatchObject({ brandKitId: kit.body.data.id, colors: { accent: '#0a1f44' } });

      // The copy is a deck of its own: readable, editable, listed.
      expect((await call(erin, 'GET', `/api/presentations/${copy._id}`, { workspace: wsA })).status).toBe(200);
      expect((await call(erin, 'PATCH', `/api/presentations/${copy._id}`, { workspace: wsA, body: { title: 'Kickoff v2' } })).status).toBe(200);
      const library = await call(alice, 'GET', '/api/library?type=presentation', { workspace: wsA });
      expect(library.body.data.items.map((card: any) => card.title).sort()).toEqual(['Kickoff v2', 'Quarterly kickoff']);

      // The original is untouched.
      const after = (await PresentationModel.findById(source._id))!.toObject();
      expect(after).toEqual(before);

      const event = await auditEvent('presentation.duplicate', copy._id);
      expect(event).toMatchObject({ actorId: new mongoose.Types.ObjectId(erin.id), targetType: 'presentation', meta: { sourceId: source._id, title: 'Copy of Quarterly kickoff' } });
      expect(String(event.workspaceId)).toBe(wsA);
    });

    it('leaves sessions, participants and answers with the original', async () => {
      const source = await createPresentation(server, inWorkspace(alice, wsA), {
        title: 'Run before copy',
        slides: [
          { type: 'select_answer', question: 'Pick one', options: [{ text: 'A', isCorrect: true }, { text: 'B' }], timeLimit: 60 },
          { type: 'wordcloud', question: 'One word', timeLimit: 0 },
        ],
      });
      const host = (command: string) => call(alice, 'POST', `/api/presentations/${source._id}/host/${command}`, { workspace: wsA });
      expect((await host('open-lobby')).status).toBe(200);
      const ada = (await call(null, 'POST', `/api/presentations/${source._id}/join`, { body: { name: 'Ada' } })).body.data;
      expect((await host('advance')).status).toBe(200);
      const answered = await call(null, 'POST', `/api/presentations/${source._id}/answer`, {
        body: { participantId: ada.participantId, participantToken: ada.token, slideIndex: 0, optionIndex: 0 },
      });
      expect(answered.status).toBe(200);
      expect((await host('end')).status).toBe(200);
      await settleLiveEngine();
      expect(await PresentationAnswerModel.countDocuments({ presentationId: source._id })).toBe(1);

      const res = await duplicateDeck(alice, source._id, wsA);
      expect(res.status).toBe(201);
      const copy = res.body.data;
      expect(copy).toMatchObject({ title: 'Copy of Run before copy', status: 'draft', sessionCount: 0, activeSessionId: null, lastSessionAt: null });
      expect(copy.slides).toHaveLength(2);
      for (const model of [PresentationSessionModel, PresentationParticipantModel, PresentationAnswerModel] as const) {
        expect(await (model as typeof PresentationSessionModel).countDocuments({ presentationId: copy._id })).toBe(0);
        expect(await (model as typeof PresentationSessionModel).countDocuments({ presentationId: source._id })).toBe(1);
      }
      expect((await call(alice, 'GET', `/api/presentations/${copy._id}/sessions`, { workspace: wsA })).body.data).toEqual([]);
      expect(await PresentationModel.findById(source._id).lean()).toMatchObject({ status: 'ended', sessionCount: 1 });

      // A copy of a running deck is a draft too, and the live original keeps running.
      expect((await host('open-lobby')).status).toBe(200);
      const live = await duplicateDeck(alice, source._id, wsA);
      expect(live.status).toBe(201);
      expect(live.body.data).toMatchObject({ status: 'draft', activeSessionId: null, title: 'Copy of Run before copy' });
      expect(await PresentationModel.findById(source._id).lean()).toMatchObject({ status: 'lobby' });
      expect((await call(null, 'GET', `/api/presentations/code/${live.body.data.joinCode}`)).status).toBe(404);
    });

    it('lets owners and editors duplicate; viewers and presenters cannot, even with a share on the deck', async () => {
      const deck = await createPresentation(server, inWorkspace(alice, wsA), { title: 'Team deck' });
      expect((await duplicateDeck(null, deck._id)).status).toBe(401);
      expect((await duplicateDeck(alice, deck._id, wsA)).status).toBe(201);
      expect((await duplicateDeck(erin, deck._id, wsA)).status).toBe(201);
      for (const user of [carol, dana]) {
        const refused = await duplicateDeck(user, deck._id, wsA);
        expect(refused).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
      }
      // A share adds deck actions on one deck, never the workspace-wide right to create.
      const shared = await call(alice, 'PUT', `/api/shares?resourceType=presentation&resourceId=${deck._id}`, {
        workspace: wsA,
        body: { shares: [{ principalType: 'user', principalId: carol.id, role: 'editor' }] },
      });
      expect(shared.status).toBe(200);
      expect((await call(carol, 'PATCH', `/api/presentations/${deck._id}`, { workspace: wsA, body: { title: 'Shared edit' } })).status).toBe(200);
      expect((await duplicateDeck(carol, deck._id, wsA)).status).toBe(403);
      expect(await PresentationModel.countDocuments({ workspaceId: wsA })).toBe(3);
      expect(await PresentationModel.countDocuments({ creatorId: { $in: [carol.id, dana.id] } })).toBe(0);
    });

    it('refuses a deck of another workspace, whichever workspace is selected, and copies nothing', async () => {
      const deck = await createPresentation(server, inWorkspace(alice, wsA), { title: 'Alpha deck' });
      for (const workspace of [wsB, undefined]) {
        expect((await duplicateDeck(bob, deck._id, workspace)).status).toBe(403);
      }
      expect((await duplicateDeck(bob, deck._id, wsA)).body.code).toBe('WORKSPACE_FORBIDDEN');
      // A member of both workspaces cannot copy across them either: the source must be in the selected one.
      await WorkspaceMemberModel.create({ workspaceId: wsB, userId: alice.id, role: 'editor' });
      expect((await duplicateDeck(alice, deck._id, wsB)).status).toBe(403);
      expect(await PresentationModel.countDocuments({})).toBe(1);
    });

    it('answers 404 for a missing, malformed or trashed deck', async () => {
      const deck = await createPresentation(server, inWorkspace(alice, wsA), { title: 'Trashed' });
      await PresentationModel.updateOne({ _id: deck._id }, { $set: { deletedAt: new Date() } });
      for (const id of [deck._id, String(new mongoose.Types.ObjectId()), 'not-an-id']) {
        expect((await duplicateDeck(alice, id, wsA)).status).toBe(404);
      }
    });

    it('copies a deck from before workspaces into the creator’s current workspace, and only for the creator', async () => {
      const deck = await createPresentation(server, inWorkspace(alice, wsA), { title: 'Old deck' });
      await PresentationModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(deck._id) }, { $unset: { workspaceId: '' } });
      expect((await duplicateDeck(erin, deck._id, wsA)).status).toBe(403);
      const res = await duplicateDeck(alice, deck._id, wsA);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ title: 'Copy of Old deck', workspaceId: wsA, creatorId: alice.id, folderId: null });
    });

    it('works through the legacy /api/quizzes alias and caps the title at 120 characters', async () => {
      const deck = await createPresentation(server, inWorkspace(alice, wsA), { title: 'T'.repeat(120) });
      const res = await call(alice, 'POST', `/api/quizzes/${deck._id}/duplicate`, { workspace: wsA });
      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe(`Copy of ${'T'.repeat(112)}`);
    });
  });

  describe('POST /api/polls/:id/duplicate', () => {
    const assessment = {
      title: 'Safety check',
      pollType: 'TRIAL',
      passingScorePercentage: 80,
      isAnonymous: false,
      isPublished: true,
      expiresAt: new Date(Date.now() + 3 * DAY).toISOString(),
      questions: [
        {
          text: 'Which exits are safe?',
          options: ['North', 'South', 'East'],
          type: 'multiple',
          correctOptionIndices: [0, 2],
          explanation: 'South is under repair',
          points: 3,
          isMandatory: false,
        },
        { text: 'Where do we meet?', options: ['Car park', 'Lobby'], type: 'single', correctOptionIndices: [0], points: 1 },
      ],
    };

    it('copies questions, answers, settings and type into an unpublished draft', async () => {
      const source = await createPoll(server, inWorkspace(alice, wsA), assessment);
      const before = (await PollModel.findById(source._id))!.toObject();

      const res = await duplicatePoll(erin, source._id, wsA);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.message).toBe('Poll duplicated successfully');
      const copy = res.body.data;
      expect(Object.keys(copy).sort()).toEqual(Object.keys(source).sort());
      expect(copy).toMatchObject({
        title: 'Copy of Safety check',
        pollType: 'TRIAL',
        passingScorePercentage: 80,
        isAnonymous: false,
        isPublished: false,
        isClosed: false,
        closedAt: null,
        isResultsPublished: false,
        resultsPublishedAt: null,
        convertedPresentationId: null,
        creatorId: erin.id,
        workspaceId: wsA,
      });
      expect(copy._id).not.toBe(source._id);
      // The source closes in three days: the copy keeps that window.
      expect(copy.expiresAt).toBe(source.expiresAt);
      expect(withoutIds(copy.questions)).toEqual(withoutIds(source.questions));
      const sourceIds = new Set(source.questions.map((question: any) => question._id));
      for (const question of copy.questions) expect(sourceIds.has(question._id)).toBe(false);

      // Its own zeroed analytics, keyed by the copy's question ids.
      const analytics = await AnalyticsModel.findOne({ pollId: copy._id }).lean();
      expect(analytics?.totalResponses).toBe(0);
      expect(analytics?.questionSummaries.map((summary) => [String(summary.questionId), summary.counts])).toEqual(
        copy.questions.map((question: any) => [question._id, question.options.map(() => 0)]),
      );

      // A draft: private to its workspace, editable there.
      expect((await call(null, 'GET', `/api/polls/${copy._id}`)).status).toBe(404);
      expect((await call(erin, 'PATCH', `/api/polls/${copy._id}`, { workspace: wsA, body: { title: 'Safety check 2' } })).status).toBe(200);

      expect((await PollModel.findById(source._id))!.toObject()).toEqual(before);
      const event = await auditEvent('poll.duplicate', copy._id);
      expect(event).toMatchObject({ targetType: 'poll', meta: { sourceId: source._id, title: 'Copy of Safety check' } });
      expect(String(event.workspaceId)).toBe(wsA);
    });

    it('never copies responses or results; a closed poll’s copy is open with an expiry a week out', async () => {
      const source = await createPoll(server, inWorkspace(alice, wsA), { title: 'Lunch vote' });
      const questionId = source.questions[0]._id;
      for (let i = 0; i < 2; i++) {
        const ballot = await call(null, 'POST', `/api/responses/poll/${source._id}/ballot`);
        const vote = await call(null, 'POST', '/api/responses', {
          body: { pollId: source._id, ballotToken: ballot.body.data.ballotToken, answers: [{ questionId, selectedOptionIndex: 0 }] },
        });
        expect(vote.status, JSON.stringify(vote.body)).toBe(201);
      }
      // The analytics worker is not running in tests; write the flushed totals it would have.
      await AnalyticsModel.updateOne({ pollId: source._id }, { $set: { totalResponses: 2, 'questionSummaries.0.counts': [2, 0] } });
      expect((await call(alice, 'POST', `/api/polls/${source._id}/close`, { workspace: wsA })).status).toBe(200);
      expect((await call(alice, 'POST', `/api/polls/${source._id}/publish-results`, { workspace: wsA })).status).toBe(200);

      const startedAt = Date.now();
      const res = await duplicatePoll(alice, source._id, wsA);
      expect(res.status).toBe(201);
      const copy = res.body.data;
      expect(copy).toMatchObject({ title: 'Copy of Lunch vote', isPublished: false, isClosed: false, isResultsPublished: false, resultsPublishedAt: null });
      const expiresAt = new Date(copy.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(startedAt + 7 * DAY - 1000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY);

      expect(await ResponseModel.countDocuments({ pollId: copy._id })).toBe(0);
      expect(await ResponseModel.countDocuments({ pollId: source._id })).toBe(2);
      expect(await AnalyticsModel.findOne({ pollId: copy._id }).lean()).toMatchObject({ totalResponses: 0, questionSummaries: [{ counts: [0, 0] }] });
      expect(await AnalyticsModel.findOne({ pollId: source._id }).lean()).toMatchObject({ totalResponses: 2 });
      expect(await PollModel.findById(source._id).lean()).toMatchObject({ isClosed: true, isResultsPublished: true });

      const library = await call(alice, 'GET', '/api/library?type=poll', { workspace: wsA });
      const card = library.body.data.items.find((item: any) => item.id === copy._id);
      expect(card).toMatchObject({ status: 'draft', stats: { questionCount: 1, responseCount: 0 } });
    });

    it('lets owners and editors duplicate; viewers and presenters cannot', async () => {
      const poll = await createPoll(server, inWorkspace(alice, wsA), { title: 'Team poll', isPublished: false });
      expect((await duplicatePoll(null, poll._id)).status).toBe(401);
      expect((await duplicatePoll(alice, poll._id, wsA)).status).toBe(201);
      expect((await duplicatePoll(erin, poll._id, wsA)).status).toBe(201);
      for (const user of [carol, dana]) {
        expect(await duplicatePoll(user, poll._id, wsA)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
      }
      expect(await PollModel.countDocuments({ workspaceId: wsA })).toBe(3);
    });

    it('refuses a poll of another workspace, whichever workspace is selected, and copies nothing', async () => {
      const draft = await createPoll(server, inWorkspace(alice, wsA), { title: 'Alpha draft', isPublished: false });
      const published = await createPoll(server, inWorkspace(alice, wsA), { title: 'Alpha published' });
      for (const poll of [draft, published]) {
        for (const workspace of [wsB, undefined]) {
          expect((await duplicatePoll(bob, poll._id, workspace)).status).toBe(403);
        }
        expect((await duplicatePoll(bob, poll._id, wsA)).body.code).toBe('WORKSPACE_FORBIDDEN');
      }
      await WorkspaceMemberModel.create({ workspaceId: wsB, userId: alice.id, role: 'editor' });
      expect((await duplicatePoll(alice, published._id, wsB)).status).toBe(403);
      expect(await PollModel.countDocuments({})).toBe(2);
    });

    it('answers 404 for a missing poll and 400 for a malformed id', async () => {
      expect((await duplicatePoll(alice, String(new mongoose.Types.ObjectId()), wsA)).status).toBe(404);
      expect((await duplicatePoll(alice, 'not-an-id', wsA)).status).toBe(400);
    });
  });
});
