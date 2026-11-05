import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { PresentationModel, PresentationSessionModel } from '../../src/modules/presentations/presentations.model';
import { createPoll, createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** W3-G: GET /api/insights through the real app, against seeded sessions and poll responses. */

const DAY = 24 * 60 * 60 * 1000;

type Totals = {
  sessions: number;
  participants: number;
  sessionAnswers: number;
  pollResponses: number;
  responses: number;
  engagement: number | null;
  decksRun: number;
};
type Insights = {
  range: { from: string; to: string; days: number; tz: string };
  totals: Totals;
  previous: Totals;
  daily: { date: string; sessions: number; participants: number; responses: number }[];
  top: { type: string; id: string; title: string; people: number; runs: number | null }[];
  recentSessions: { title: string; runNumber: number; isLive: boolean; participationRate: number | null }[];
  liveNow: { sessions: number; polls: number };
};

describeIntegration('insights over HTTP', () => {
  let server: TestServer;
  let owner: TestUser;
  let stranger: TestUser;
  const now = Date.now();
  let kickoffId = '';
  let retroId = '';
  let lunchId = '';

  const get = async (user: TestUser | null, query = '') => {
    const res = await server.request(`/api/insights${query}`, { headers: user ? user.headers : {} });
    return { status: res.status, body: (await res.json()) as { data: Insights; message: string } };
  };

  /** A session written straight to Mongo, as the engine leaves it. */
  const session = async (
    deckId: string,
    run: number,
    startedAgoMs: number,
    fields: { participants: number; answers: number; responseSlides: number; live?: boolean },
  ) => {
    const deck = await PresentationModel.findById(deckId).lean();
    await PresentationSessionModel.create({
      presentationId: deckId,
      workspaceId: deck!.workspaceId,
      hostUserId: String(deck!.creatorId),
      runNumber: run,
      joinCode: String(100000 + run),
      status: fields.live ? 'active' : 'ended',
      isLive: Boolean(fields.live),
      startedAt: new Date(now - startedAgoMs),
      endedAt: fields.live ? null : new Date(now - startedAgoMs + 30 * 60 * 1000),
      participantCount: fields.participants,
      answerCount: fields.answers,
      slideStats: Array.from({ length: fields.responseSlides }, (_, i) => ({
        slideId: new mongoose.Types.ObjectId(),
        slideIndex: i,
        type: 'select_answer',
        answeredCount: 0,
      })),
    });
  };

  /** Poll responses written raw, so their submission time can be in the past. */
  const responses = async (pollId: string, agoMs: number[]) => {
    await mongoose.connection.db!.collection('responses').insertMany(
      agoMs.map((ago) => ({
        pollId: new mongoose.Types.ObjectId(pollId),
        answers: [],
        createdAt: new Date(now - ago),
        updatedAt: new Date(now - ago),
      })),
    );
  };

  beforeAll(async () => {
    server = await startTestServer();
    await resetTestData();
    owner = await createVerifiedUser();
    stranger = await createVerifiedUser();

    kickoffId = (await createPresentation(server, owner, { title: 'Kickoff' }))._id;
    retroId = (await createPresentation(server, owner, { title: 'Retro' }))._id;
    lunchId = (await createPoll(server, owner, { title: 'Lunch vote' }))._id;
    const strangerDeck = (await createPresentation(server, stranger, { title: 'Not yours' }))._id;

    // In the last 30 days: two ended runs of Kickoff and a live Retro.
    await session(kickoffId, 1, 2 * DAY, { participants: 10, answers: 18, responseSlides: 2 });
    await session(kickoffId, 2, 1 * DAY, { participants: 6, answers: 6, responseSlides: 1 });
    await session(retroId, 1, 3 * 60 * 60 * 1000, { participants: 4, answers: 2, responseSlides: 0, live: true });
    // The 30 days before: one Kickoff run and one poll response.
    await session(kickoffId, 3, 40 * DAY, { participants: 5, answers: 5, responseSlides: 1 });
    await responses(lunchId, [1 * DAY, 1 * DAY + 60_000, 2 * DAY, 45 * DAY]);
    // Someone else's workspace never counts.
    await session(strangerDeck, 1, 1 * DAY, { participants: 99, answers: 99, responseSlides: 1 });
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  const range = `?from=${new Date(now - 30 * DAY).toISOString()}&to=${new Date(now).toISOString()}`;

  it('requires authentication', async () => {
    expect((await get(null)).status).toBe(401);
  });

  it('totals the range and the period before it', async () => {
    const { status, body } = await get(owner, range);
    expect(status).toBe(200);
    expect(body.data.totals).toEqual({
      sessions: 3,
      participants: 20,
      sessionAnswers: 26,
      pollResponses: 3,
      responses: 29,
      // Ended sessions only: (18 + 6) answers of (10×2 + 6×1) possible.
      engagement: 24 / 26,
      decksRun: 2,
    });
    expect(body.data.previous).toMatchObject({ sessions: 1, participants: 5, pollResponses: 1, responses: 6, decksRun: 1 });
    expect(body.data.range).toMatchObject({ days: 30, tz: 'UTC' });
  });

  it('gives every day of the range, zeros included', async () => {
    const { body } = await get(owner, range);
    const daily = body.data.daily;
    expect(daily.length).toBeGreaterThanOrEqual(30);
    expect(daily.length).toBeLessThanOrEqual(31);
    expect(daily.map((d) => d.date)).toEqual([...daily.map((d) => d.date)].sort());
    expect(daily.reduce((sum, d) => sum + d.participants, 0)).toBe(20);
    expect(daily.reduce((sum, d) => sum + d.responses, 0)).toBe(29);
    expect(daily.reduce((sum, d) => sum + d.sessions, 0)).toBe(3);
  });

  it('ranks decks by participants and polls by responses together', async () => {
    const { body } = await get(owner, range);
    expect(body.data.top.map((t) => [t.type, t.title, t.people, t.runs])).toEqual([
      ['presentation', 'Kickoff', 16, 2],
      ['presentation', 'Retro', 4, 1],
      ['poll', 'Lunch vote', 3, null],
    ]);
  });

  it('lists the latest sessions and what is live now', async () => {
    const { body } = await get(owner, range);
    expect(body.data.recentSessions.map((s) => [s.title, s.runNumber, s.isLive, s.participationRate])).toEqual([
      ['Retro', 1, true, null],
      ['Kickoff', 2, false, 1],
      ['Kickoff', 1, false, 0.9],
    ]);
    expect(body.data.liveNow).toEqual({ sessions: 1, polls: 1 });
  });

  it('counts days in the requested time zone', async () => {
    const { body } = await get(owner, `${range}&tz=Asia/Kolkata`);
    expect(body.data.range.tz).toBe('Asia/Kolkata');
    expect(body.data.daily.reduce((sum, d) => sum + d.responses, 0)).toBe(29);
  });

  it('defaults to the last 30 days', async () => {
    const { body } = await get(owner);
    expect(body.data.range.days).toBe(30);
    expect(body.data.totals.sessions).toBe(3);
  });

  it('only shows the caller workspace', async () => {
    const { body } = await get(stranger, range);
    expect(body.data.totals).toMatchObject({ sessions: 1, participants: 99, pollResponses: 0 });
    expect(body.data.top.map((t) => t.title)).toEqual(['Not yours']);
  });

  it('rejects a backwards, too long or unknown range', async () => {
    const at = (ms: number) => new Date(ms).toISOString();
    expect((await get(owner, `?from=${at(now)}&to=${at(now - DAY)}`)).status).toBe(400);
    expect((await get(owner, `?from=${at(now - 400 * DAY)}&to=${at(now)}`)).status).toBe(400);
    expect((await get(owner, `?tz=Mars/Base`)).status).toBe(400);
    expect((await get(owner, `?from=yesterday`)).status).toBe(400);
  });
});
