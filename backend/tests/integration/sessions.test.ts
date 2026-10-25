import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import {
  PresentationAnswerModel,
  PresentationParticipantModel,
  PresentationSessionModel,
} from '../../src/modules/presentations/presentations.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * The session engine through the real app (createApp, Mongo, Redis, sockets):
 * repeated runs, navigation both ways, reveal and close stopping answers,
 * reconciliation after a lost write-behind, the audience cap, and the
 * workspace policy on host routes and host socket joins.
 */

type Envelope = { type: string; sessionId: string | null; payload: Record<string, any> };
type Body<T = any> = { success: boolean; message: string; code?: string; data: T };

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

const SELECT = {
  type: 'select_answer',
  question: 'Capital of France?',
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 60,
};
const CLOUD = { type: 'wordcloud', question: 'One word', timeLimit: 0 };
const BOARD = { type: 'leaderboard', question: 'Standings' };

describeIntegration('presentation sessions over HTTP', () => {
  let server: TestServer;
  let host: TestUser;

  const call = async <T = any>(method: string, path: string, options: { user?: TestUser; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await server.request(`/api/presentations${path}`, {
      method,
      headers: { ...(options.user?.headers ?? {}), ...(options.headers ?? {}) },
      body: options.body,
    });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  const createDeck = async (slides: unknown[], user = host, headers: Record<string, string> = {}) => {
    const res = await call('POST', '/', { user, headers, body: { title: 'Sessions deck', slides } });
    expect(res.status).toBe(201);
    return res.body.data as { _id: string; joinCode: string; slides: { _id: string }[]; workspaceId?: string };
  };

  const hostCommand = async (pid: string, command: string, body?: unknown, user = host, headers: Record<string, string> = {}) =>
    call('POST', `/${pid}/host/${command}`, { user, body, headers });

  const join = async (pid: string, name: string, deviceToken?: string) => {
    const res = await call('POST', `/${pid}/join`, { body: { name, ...(deviceToken ? { deviceToken } : {}) } });
    return res;
  };

  const answer = (pid: string, who: { participantId: string; token: string }, slideIndex: number, body: Record<string, unknown>) =>
    call('POST', `/${pid}/answer`, {
      body: { participantId: who.participantId, participantToken: who.token, slideIndex, ...body },
    });

  /** A host socket following the deck through `live:join`. */
  const hostSocket = async (pid: string, user = host) => {
    const socket = server.connectSocket({ auth: { token: `Bearer ${user.accessToken}` } });
    const events: Envelope[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    await waitFor(() => socket.connected, 'socket connect');
    const ack = await socket.timeout(3000).emitWithAck('live:join', { presentationId: pid, role: 'host' });
    return { socket, events, ack };
  };

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    host = await createVerifiedUser({ name: 'Host' });
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('runs a deck twice into two sessions with independent leaderboards and keeps both', async () => {
    const deck = await createDeck([SELECT, BOARD]);
    const pid = deck._id;
    expect(deck.workspaceId).toBeDefined();
    const { events, ack } = await hostSocket(pid);
    expect(ack).toEqual({ ok: true, role: 'host' });

    const run1 = await hostCommand(pid, 'open-lobby');
    expect(run1.status).toBe(200);
    expect(run1.body.data).toMatchObject({ _id: pid, status: 'lobby', session: { runNumber: 1, status: 'lobby' } });
    const ada = (await join(pid, 'Ada')).body.data;
    expect(ada.sessionId).toBe(run1.body.data.session.sessionId);
    await hostCommand(pid, 'advance');
    expect((await answer(pid, ada, 0, { optionIndex: 0 })).status).toBe(200);
    await hostCommand(pid, 'reveal');
    await hostCommand(pid, 'end');

    const run2 = await hostCommand(pid, 'open-lobby');
    expect(run2.body.data.session).toMatchObject({ runNumber: 2, status: 'lobby' });
    const grace = (await join(pid, 'Grace')).body.data;
    await hostCommand(pid, 'start');
    expect((await answer(pid, grace, 0, { optionIndex: 1 })).status).toBe(200);
    // Ada's credentials belong to run 1.
    expect((await answer(pid, ada, 0, { optionIndex: 0 })).body.code).toBe('PARTICIPANT_STALE');
    const ended = await hostCommand(pid, 'end');
    expect(ended.body.data).toMatchObject({ status: 'ended', activeSessionId: null, sessionCount: 2 });

    const list = await call('GET', `/${pid}/sessions`, { user: host });
    expect(list.body.data.map((s: any) => [s.runNumber, s.status, s.participantCount, s.answerCount])).toEqual([
      [2, 'ended', 1, 1],
      [1, 'ended', 1, 1],
    ]);
    const sessions = await PresentationSessionModel.find({ presentationId: pid }).sort({ runNumber: 1 }).lean();
    expect(sessions.map((s) => s.finalLeaderboard.map((e) => [e.name, e.score > 0]))).toEqual([
      [['Ada', true]],
      [['Grace', false]],
    ]);
    expect(await PresentationParticipantModel.countDocuments({ presentationId: pid })).toBe(2);
    await waitFor(async () => (await PresentationAnswerModel.countDocuments({ presentationId: pid })) === 2, 'answers');

    const sid1 = run1.body.data.session.sessionId;
    const sid2 = run2.body.data.session.sessionId;
    await waitFor(() => events.filter((e) => e.type === 'session:ended').length === 2, 'session:ended x2');
    const typesOf = (sid: string) => events.filter((e) => e.sessionId === sid).map((e) => e.type);
    expect(typesOf(sid1)).toEqual([
      'session:lobby',
      'lobby:opened',
      'participant:joined',
      'question:started',
      'answer:received',
      'question:revealed',
      'session:ended',
      'quiz:ended',
    ]);
    expect(typesOf(sid2)).toEqual([
      'session:lobby',
      'lobby:opened',
      'participant:joined',
      'question:started',
      'answer:received',
      'session:ended',
      'quiz:ended',
    ]);
  });

  it('navigates both ways; reveal and close stop answers; revisits keep their results', async () => {
    const deck = await createDeck([SELECT, CLOUD, BOARD]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = (await join(pid, 'Ada')).body.data;
    const linus = (await join(pid, 'Linus')).body.data;

    await hostCommand(pid, 'goto', { slideIndex: 0 });
    expect((await answer(pid, ada, 0, { optionIndex: 0 })).status).toBe(200);
    const revealed = await hostCommand(pid, 'reveal');
    expect(revealed.body.data.session.current).toMatchObject({ phase: 'revealed', answeredCount: 1 });
    // Well before the 60s deadline, yet refused: reveal closed the slide.
    const late = await answer(pid, linus, 0, { optionIndex: 1 });
    expect([late.status, late.body.message]).toEqual([400, 'This slide is no longer accepting answers']);

    const cloud = await hostCommand(pid, 'goto', { slideId: deck.slides[1]!._id });
    expect(cloud.body.data).toMatchObject({ currentSlideIndex: 1, questionEndsAt: null });
    expect(cloud.body.data.session.current).toMatchObject({ phase: 'open', endsAt: null });
    expect((await answer(pid, ada, 1, { entries: ['sun'] })).status).toBe(200);
    const closed = await hostCommand(pid, 'close');
    expect(closed.body.data.session.current).toMatchObject({ phase: 'closed', answeredCount: 1 });
    expect((await answer(pid, linus, 1, { entries: ['moon'] })).status).toBe(400);

    const back = await hostCommand(pid, 'goto', { slideIndex: 0 });
    expect(back.body.data.session.current).toMatchObject({ slideIndex: 0, phase: 'revealed', answeredCount: 1 });
    const reopened = await hostCommand(pid, 'reopen');
    expect(reopened.body.data.session.current.phase).toBe('open');
    expect((await answer(pid, linus, 0, { optionIndex: 1 })).status).toBe(200);
    expect((await hostCommand(pid, 'advance')).body.data.session.current).toMatchObject({ slideIndex: 1, phase: 'closed' });
    expect((await hostCommand(pid, 'advance')).body.data.session.current).toMatchObject({ slideIndex: 2, phase: 'shown' });
    expect((await hostCommand(pid, 'goto', { slideIndex: 9 })).status).toBe(400);
    expect((await hostCommand(pid, 'goto', {})).status).toBe(400);

    const state = (await call('GET', `/${pid}/host/state`, { user: host })).body.data;
    expect(state.slideStates.map((s: any) => [s.slideIndex, s.phase, s.answeredCount])).toEqual([
      [0, 'closed', 2],
      [1, 'closed', 1],
      [2, 'shown', 0],
    ]);
    expect(state.distributions[deck.slides[0]!._id].distribution.counts).toEqual([1, 1]);
    expect(state.participants.map((p: any) => p.name)).toEqual(['Ada', 'Linus']);

    const live = (await call('GET', `/${pid}/live-state?participantId=${ada.participantId}&token=${ada.token}`)).body.data;
    expect(live).toMatchObject({ status: 'active', current: { slideIndex: 2, phase: 'shown' }, me: { name: 'Ada', rank: 1 } });
    expect(live.current.leaderboard[0].name).toBe('Ada');
    expect((await call('GET', `/${pid}/live-state?participantId=${ada.participantId}&token=${'x'.repeat(48)}`)).status).toBe(401);
  });

  it('reconciles answers the write-behind lost when the session ends', async () => {
    const deck = await createDeck([SELECT]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = (await join(pid, 'Ada')).body.data;
    const linus = (await join(pid, 'Linus')).body.data;
    await hostCommand(pid, 'advance');
    await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-offline-1' });
    await answer(pid, linus, 0, { optionIndex: 1 });
    await waitFor(async () => (await PresentationAnswerModel.countDocuments({ presentationId: pid })) === 2, 'write-behind');
    await waitFor(async () => ((await PresentationParticipantModel.findById(ada.participantId).lean())?.score ?? 0) > 0, 'score');

    // Simulate a lost write-behind: Ada's answer and total never reached Mongo.
    const original = await PresentationAnswerModel.findOne({ participantId: ada.participantId }).lean();
    await PresentationAnswerModel.deleteOne({ _id: original!._id });
    await PresentationParticipantModel.updateOne({ _id: ada.participantId }, { $set: { score: 0, correctCount: 0 } });

    const ended = await hostCommand(pid, 'end');
    expect(ended.body.data.session).toMatchObject({ status: 'ended', participantCount: 2, answerCount: 2 });
    const restored = await PresentationAnswerModel.findOne({ participantId: ada.participantId }).lean();
    expect(restored).toMatchObject({
      slideIndex: 0,
      optionIndex: 0,
      isCorrect: true,
      score: original!.score,
      timeMs: original!.timeMs,
      clientAnswerId: 'ada-offline-1',
      via: 'rest',
    });
    expect(String(restored!.sessionId)).toBe(String(original!.sessionId));
    expect(String(restored!.slideId)).toBe(deck.slides[0]!._id);
    expect(await PresentationParticipantModel.findById(ada.participantId).lean()).toMatchObject({
      score: original!.score,
      correctCount: 1,
    });

    const session = await PresentationSessionModel.findOne({ presentationId: pid }).lean();
    expect(session!.slideStats.map((s) => [s.answeredCount, (s.distribution as any).counts])).toEqual([[2, [1, 1]]]);
    expect(session!.finalLeaderboard[0]).toMatchObject({ name: 'Ada', score: original!.score, rank: 1 });
    expect(session!.retainUntil!.getTime()).toBe(session!.endedAt!.getTime() + 365 * 24 * 3600 * 1000);
  });

  it("stops joins at the workspace plan's audience cap, snapshotted when the session opens", async () => {
    const deck = await createDeck([SELECT]);
    const pid = deck._id;
    await WorkspaceModel.updateOne({ _id: deck.workspaceId }, { $set: { planOverrides: { limits: { audienceCap: 2 } } } });
    const opened = await hostCommand(pid, 'open-lobby');
    expect(opened.body.data.session.audienceCap).toBe(2);

    const ada = await join(pid, 'Ada');
    expect((await join(pid, 'Linus')).status).toBe(200);
    const third = await join(pid, 'Grace');
    expect(third.status).toBe(403);
    expect(third.body).toMatchObject({ success: false, code: 'SESSION_FULL' });
    // The same device always gets back in.
    const again = await join(pid, 'Ada', ada.body.data.deviceToken);
    expect(again.status).toBe(200);
    expect(again.body.data.participantId).toBe(ada.body.data.participantId);
    // Raising the plan later does not change the open session.
    await WorkspaceModel.updateOne({ _id: deck.workspaceId }, { $set: { planOverrides: null } });
    expect((await join(pid, 'Alan')).status).toBe(403);
  });

  it('applies the workspace policy to decks, host commands and host socket joins', async () => {
    const other = await createVerifiedUser({ name: 'Other' });
    const deck = await createDeck([SELECT]);

    expect((await call('GET', `/${deck._id}`, { user: other })).body.code).toBe('FORBIDDEN');
    expect((await hostCommand(deck._id, 'open-lobby', undefined, other)).status).toBe(403);
    expect((await call('GET', '/', { user: other })).body.data).toEqual([]);
    expect((await call('GET', '/', { user: host })).body.data.map((d: any) => d._id)).toEqual([deck._id]);
    expect((await hostSocket(deck._id, other)).ack).toEqual({ ok: false, error: 'FORBIDDEN' });

    // A team workspace where `other` presents.
    const team = await WorkspaceModel.create({
      name: 'Team',
      slug: `team-${new mongoose.Types.ObjectId()}`,
      type: 'team',
      ownerId: host.id,
    });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: host.id, role: 'owner' });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: other.id, role: 'presenter' });
    const inTeam = { 'X-Workspace-Id': String(team._id) };
    const teamDeck = await createDeck([SELECT], host, inTeam);
    expect(teamDeck.workspaceId).toBe(String(team._id));

    expect((await call('GET', '/', { user: host })).body.data.map((d: any) => d._id)).toEqual([deck._id]);
    expect((await call('GET', '/', { user: other, headers: inTeam })).body.data.map((d: any) => d._id)).toEqual([teamDeck._id]);
    expect((await hostCommand(teamDeck._id, 'open-lobby', undefined, other, inTeam)).status).toBe(200);
    expect((await call('PATCH', `/${teamDeck._id}`, { user: other, headers: inTeam, body: { title: 'Mine' } })).status).toBe(403);
    // Outside the team workspace context the same deck is not reachable.
    expect((await hostCommand(teamDeck._id, 'end', undefined, other)).status).toBe(403);
    // Sockets authorize against the deck's own workspace.
    expect((await hostSocket(teamDeck._id, other)).ack).toEqual({ ok: true, role: 'host' });
    expect((await call('GET', `/${teamDeck._id}/sessions`, { user: other, headers: inTeam })).status).toBe(200);
  });
});
