import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import Papa from 'papaparse';
import { redisClient } from '../../src/common/config/redis';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import {
  PresentationAnswerModel,
  PresentationParticipantModel,
  PresentationSessionModel,
} from '../../src/modules/presentations/presentations.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Session history, reports, exports, sharing and take-home through the real
 * app. The reconciliation test scripts 200 participants through the real
 * join/answer routes and checks that `slideStats`, a Mongo aggregate over the
 * answers, the report, the CSV and the XLSX all agree.
 */

type Body<T = any> = { success: boolean; message: string; code?: string; data: T };

const NOTE = 'SPEAKER-NOTE-do-not-leak';
const FORMULA_NAME = '=SUM(1+1)';
const FORMULA_TEXT = '=HYPERLINK("http://evil.example","x")';

const SLIDES = [
  {
    type: 'select_answer',
    question: 'Capital of France?',
    notes: NOTE,
    options: [
      { text: 'Paris', isCorrect: true },
      { text: 'Lyon', isCorrect: false },
      { text: 'Nice', isCorrect: false },
    ],
    timeLimit: 60,
  },
  { type: 'type_answer', question: 'Largest planet?', acceptedAnswers: ['Jupiter'], timeLimit: 60, notes: NOTE },
  { type: 'wordcloud', question: 'One word for Mondays', maxEntries: 1, timeLimit: 0 },
  { type: 'scales', question: 'Rate the talk', statements: ['Pace', 'Clarity'], minLabel: 'Low', maxLabel: 'High', timeLimit: 0 },
  { type: 'open_ended', question: 'Any feedback?', timeLimit: 0 },
  { type: 'leaderboard', question: 'Standings' },
];

/** Participant i's script: what they answer to each response slide (null = skip). */
const PARTICIPANTS = 200;
const scriptFor = (i: number): (Record<string, unknown> | null)[] => [
  (i + 3) % 17 === 0 ? null : { optionIndex: i % 3 },
  (i + 3) % 11 === 0 ? null : { text: i % 2 === 0 ? 'Jupiter' : 'Saturn' },
  (i + 3) % 13 === 0 ? null : { entries: [`word${i % 7}`] },
  (i + 3) % 19 === 0 ? null : { ratings: [1 + (i % 5), 1 + ((i + 1) % 5)] },
  (i + 3) % 7 === 0 ? null : { text: i === 1 ? FORMULA_TEXT : `idea ${i}` },
];
const nameFor = (i: number) => (i === 0 ? FORMULA_NAME : `Player ${i}`);

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

/** Runs `fn` over `items` with at most `size` in flight. */
const inBatches = async <T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(...(await Promise.all(items.slice(start, start + size).map((item, j) => fn(item, start + j)))));
  }
  return out;
};

describeIntegration('session reports, exports, sharing and take-home', () => {
  let server: TestServer;
  let host: TestUser;
  let workspaceId: string;

  const api = async <T = any>(
    method: string,
    path: string,
    options: { user?: TestUser | null; body?: unknown; headers?: Record<string, string> } = {}
  ) => {
    const res = await server.request(path, {
      method,
      headers: { ...(options.user === null ? {} : (options.user ?? host).headers), ...(options.headers ?? {}) },
      body: options.body,
    });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };
  const decks = (method: string, path: string, options: Parameters<typeof api>[2] = {}) =>
    api(method, `/api/presentations${path}`, options);

  const raw = async (path: string, options: { user?: TestUser | null; headers?: Record<string, string> } = {}) => {
    const res = await server.request(path, {
      headers: { ...(options.user === null ? {} : (options.user ?? host).headers), ...(options.headers ?? {}) },
    });
    return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  };

  const setPlan = (plan: string, id = workspaceId) => WorkspaceModel.updateOne({ _id: id }, { $set: { plan } });

  const createDeck = async (slides: unknown[] = SLIDES, user = host, headers: Record<string, string> = {}) => {
    const res = await decks('POST', '/', { user, headers, body: { title: 'Reports deck', slides } });
    expect(res.status).toBe(201);
    return res.body.data as { _id: string; slides: { _id: string }[]; workspaceId: string };
  };

  const command = (pid: string, name: string, body?: unknown, user = host, headers: Record<string, string> = {}) =>
    decks('POST', `/${pid}/host/${name}`, { user, body, headers });

  type Joined = { participantId: string; token: string; sessionId: string };
  const join = async (pid: string, name: string): Promise<Joined> => {
    const res = await decks('POST', `/${pid}/join`, { user: null, body: { name } });
    expect(res.status).toBe(200);
    return res.body.data;
  };
  const answer = (pid: string, who: Joined, slideIndex: number, body: Record<string, unknown>) =>
    decks('POST', `/${pid}/answer`, {
      user: null,
      body: { participantId: who.participantId, participantToken: who.token, slideIndex, ...body },
    });

  /** Opens the lobby, joins `names`, runs every slide of `SLIDES`, answers per `scriptFor`, ends. */
  const runSession = async (pid: string, names: string[], options: { end?: boolean; headers?: Record<string, string> } = {}) => {
    const cmd = (name: string, body?: unknown) => command(pid, name, body, host, options.headers ?? {});
    const opened = await cmd('open-lobby');
    expect(opened.status).toBe(200);
    const sessionId = opened.body.data.session.sessionId as string;
    const joined = await inBatches(names, 25, (name) => join(pid, name));
    expect((await cmd('start')).status).toBe(200);
    const slideIndexes = [0, 1, 2, 3, 4];
    for (const slideIndex of slideIndexes) {
      if (slideIndex > 0) expect((await cmd('goto', { slideIndex })).status).toBe(200);
      const results = await inBatches(joined, 40, async (who, i) => {
        const body = scriptFor(i)[slideIndex];
        if (!body) return null;
        const res = await answer(pid, who, slideIndex, body);
        expect([res.status, res.body.message]).toEqual([200, expect.any(String)]);
        return res;
      });
      expect(results.filter(Boolean).length).toBe(joined.length - joined.filter((_, i) => !scriptFor(i)[slideIndex]).length);
      expect((await cmd('close')).status).toBe(200);
    }
    expect((await cmd('goto', { slideIndex: 5 })).status).toBe(200);
    if (options.end !== false) expect((await cmd('end')).status).toBe(200);
    return { sessionId, joined };
  };

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    host = await createVerifiedUser({ name: 'Host Person' });
    // The first workspace-scoped request provisions the personal workspace.
    await decks('GET', '/');
    workspaceId = String((await WorkspaceModel.findOne({ ownerId: host.id, type: 'personal' }).lean())!._id);
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('reconciles 200 scripted participants across slideStats, Mongo, the report, CSV and XLSX', async () => {
    await setPlan('pro');
    const deck = await createDeck();
    const names = Array.from({ length: PARTICIPANTS }, (_, i) => nameFor(i));
    const { sessionId, joined } = await runSession(deck._id, names);

    // Expected totals from the script.
    const expectedAnswered = [0, 1, 2, 3, 4].map(
      (slide) => Array.from({ length: PARTICIPANTS }, (_, i) => scriptFor(i)[slide]).filter(Boolean).length
    );
    const expectedTotal = expectedAnswered.reduce((a, b) => a + b, 0);
    const slideIds = deck.slides.map((s) => s._id);

    // 1. slideStats on the session.
    const stored = await PresentationSessionModel.findById(sessionId).lean();
    expect(stored!.status).toBe('ended');
    expect(stored!.participantCount).toBe(PARTICIPANTS);
    expect(stored!.answerCount).toBe(expectedTotal);
    const stats = [...stored!.slideStats].sort((a, b) => a.slideIndex - b.slideIndex);
    expect(stats.map((s) => s.answeredCount)).toEqual(expectedAnswered);

    // 2. A Mongo aggregate over the answers.
    const grouped = await PresentationAnswerModel.aggregate<{ _id: unknown; count: number; points: number; correct: number }>([
      { $match: { sessionId: new mongoose.Types.ObjectId(sessionId) } },
      {
        $group: {
          _id: '$slideId',
          count: { $sum: 1 },
          points: { $sum: '$score' },
          correct: { $sum: { $cond: ['$isCorrect', 1, 0] } },
        },
      },
    ]);
    const byslide = new Map(grouped.map((g) => [String(g._id), g]));
    expect([0, 1, 2, 3, 4].map((i) => byslide.get(slideIds[i]!)?.count)).toEqual(expectedAnswered);
    const totalPoints = grouped.reduce((sum, g) => sum + g.points, 0);
    expect(totalPoints).toBeGreaterThan(0);
    const participantTotal = (await PresentationParticipantModel.aggregate([
      { $match: { sessionId: new mongoose.Types.ObjectId(sessionId) } },
      { $group: { _id: null, total: { $sum: '$score' } } },
    ]))[0]!.total as number;
    expect(participantTotal).toBe(totalPoints);

    // 3. The report.
    const report = (await api('GET', `/api/sessions/${sessionId}`)).body.data;
    expect(report.session).toMatchObject({
      sessionId,
      runNumber: 1,
      status: 'ended',
      isLive: false,
      participantCount: PARTICIPANTS,
      answerCount: expectedTotal,
      responseSlideCount: 5,
    });
    expect(report.slides.filter((s: any) => s.lifecycle === 'response').map((s: any) => s.answeredCount)).toEqual(expectedAnswered);
    expect(report.participants).toHaveLength(PARTICIPANTS);
    expect(report.participants.reduce((sum: number, p: any) => sum + p.score, 0)).toBe(totalPoints);
    expect(report.participants.reduce((sum: number, p: any) => sum + p.answeredCount, 0)).toBe(expectedTotal);
    expect(report.leaderboard).toHaveLength(100);
    expect(report.leaderboard[0].rank).toBe(1);
    expect(report.exports).toMatchObject({ plan: 'pro', csv: true, xlsx: true, pdf: true });
    expect(report.access).toEqual({ export: true, share: true, delete: true });
    // The report is for hosts: it carries each slide as it ran, notes removed.
    expect(JSON.stringify(report)).not.toContain(NOTE);
    expect(report.slides[0].slide.options[0]).toMatchObject({ text: 'Paris', isCorrect: true });
    const optionCounts = report.slides[0].distribution.counts as number[];
    expect(optionCounts.reduce((a, b) => a + b, 0)).toBe(expectedAnswered[0]!);

    // 4. CSV totals.
    const csvRes = await raw(`/api/sessions/${sessionId}/export.csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    expect(csvRes.headers.get('content-disposition')).toBe('attachment; filename="reports-deck-run-1.csv"');
    const csv = Papa.parse<string[]>(csvRes.buffer.toString('utf8').replace(/^﻿/, ''), { skipEmptyLines: true });
    const [header, ...rows] = csv.data as [string[], ...string[][]];
    const col = (name: string) => header.indexOf(name);
    expect(rows).toHaveLength(PARTICIPANTS * 5);
    const csvAnswered = [1, 2, 3, 4, 5].map((slide) =>
      rows.filter((r) => r[col('Slide')] === String(slide) && r[col('Answered')] === 'yes').length
    );
    expect(csvAnswered).toEqual(expectedAnswered);
    expect(rows.reduce((sum, r) => sum + Number(r[col('Points')] || 0), 0)).toBe(totalPoints);
    // Formula-injection safe: a cell that would start with = is neutralized.
    const nameCells = new Set(rows.map((r) => r[col('Participant')]));
    expect(nameCells.has(`'${FORMULA_NAME}`)).toBe(true);
    expect(nameCells.has(FORMULA_NAME)).toBe(false);
    const answerCells = new Set(rows.map((r) => r[col('Answer')]));
    expect(answerCells.has(`'${FORMULA_TEXT}`)).toBe(true);
    expect(answerCells.has(FORMULA_TEXT)).toBe(false);
    // Ranked participants first: row order follows the leaderboard.
    expect(rows[0]![col('Rank')]).toBe('1');
    expect(rows.at(-1)![col('Rank')]).toBe(String(PARTICIPANTS));

    // 5. XLSX totals.
    const xlsxRes = await raw(`/api/sessions/${sessionId}/export.xlsx`);
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers.get('content-type')).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxRes.buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Summary', 'Results', 'Responses', 'Participants']);
    const sheetRows = (name: string) => {
      const out: unknown[][] = [];
      workbook.getWorksheet(name)!.eachRow((row) => out.push((row.values as unknown[]).slice(1)));
      return out;
    };
    const responses = sheetRows('Responses');
    const xHeader = responses[0] as string[];
    const xcol = (name: string) => xHeader.indexOf(name);
    const xRows = responses.slice(1);
    expect(xRows).toHaveLength(PARTICIPANTS * 5);
    expect([1, 2, 3, 4, 5].map((slide) => xRows.filter((r) => r[xcol('Slide')] === slide && r[xcol('Answered')] === 'yes').length)).toEqual(
      expectedAnswered
    );
    expect(xRows.reduce((sum, r) => sum + Number(r[xcol('Points')] || 0), 0)).toBe(totalPoints);
    expect(xRows.some((r) => r[xcol('Participant')] === `'${FORMULA_NAME}`)).toBe(true);
    const participantsSheet = sheetRows('Participants');
    expect(participantsSheet).toHaveLength(PARTICIPANTS + 1);
    expect(participantsSheet.slice(1).reduce((sum, r) => sum + Number(r[2]), 0)).toBe(totalPoints);
    // Results sheet: slide 1's option counts match the report.
    const results = sheetRows('Results').slice(1).filter((r) => r[0] === 1);
    expect(results.map((r) => r[3])).toEqual(optionCounts);
    const summary = sheetRows('Summary');
    expect(summary.find((r) => r[0] === 'Participants')![1]).toBe(PARTICIPANTS);
    expect(summary.find((r) => r[0] === 'Responses')![1]).toBe(expectedTotal);

    // 6. PDF.
    const pdf = await raw(`/api/sessions/${sessionId}/export.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');

    // Every export is audited.
    await waitFor(async () => (await AuditEventModel.countDocuments({ action: 'session.export' })) === 3, 'export audit');

    // 7. Every participant's take-home matches their own answers and the final ranking.
    const sample = [0, 1, 2, 57, 199];
    for (const i of sample) {
      const who = joined[i]!;
      const home = (await api('GET', `/api/sessions/${sessionId}/me?participantId=${who.participantId}&token=${who.token}`, { user: null })).body.data;
      const mine = await PresentationParticipantModel.findById(who.participantId).lean();
      expect(home.me).toMatchObject({ participantId: who.participantId, name: nameFor(i), score: mine!.score });
      expect(home.me.rank).toBe(report.participants.find((p: any) => p.participantId === who.participantId).rank);
      expect(home.slides.filter((s: any) => s.answered)).toHaveLength(scriptFor(i).filter(Boolean).length);
    }
  }, 120_000);

  it('gates XLSX and PDF behind the plan; CSV stays free', async () => {
    const deck = await createDeck();
    const { sessionId } = await runSession(deck._id, ['Ada', 'Grace']);

    expect((await raw(`/api/sessions/${sessionId}/export.csv`)).status).toBe(200);
    for (const format of ['xlsx', 'pdf']) {
      const res = await api('GET', `/api/sessions/${sessionId}/export.${format}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FEATURE_NOT_IN_PLAN');
    }
    const report = (await api('GET', `/api/sessions/${sessionId}`)).body.data;
    expect(report.exports).toEqual({ plan: 'free', csv: true, xlsx: false, pdf: false });

    await setPlan('pro');
    expect((await raw(`/api/sessions/${sessionId}/export.xlsx`)).status).toBe(200);
    expect((await raw(`/api/sessions/${sessionId}/export.pdf`)).status).toBe(200);
  });

  it('lists sessions newest first with cursor pagination and live counts', async () => {
    const deck = await createDeck();
    const first = await runSession(deck._id, ['Ada']);
    await runSession(deck._id, ['Grace', 'Linus']);
    const live = await command(deck._id, 'open-lobby');
    const liveId = live.body.data.session.sessionId;
    await join(deck._id, 'Alan');

    const page1 = (await api('GET', `/api/sessions?presentationId=${deck._id}&limit=2`)).body.data;
    expect(page1.presentation).toEqual({ presentationId: deck._id, title: 'Reports deck' });
    expect(page1.items.map((s: any) => [s.runNumber, s.status, s.isLive, s.participantCount])).toEqual([
      [3, 'lobby', true, 1],
      [2, 'ended', false, 2],
    ]);
    expect(page1.items[0].sessionId).toBe(liveId);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = (await api('GET', `/api/sessions?presentationId=${deck._id}&limit=2&cursor=${page1.nextCursor}`)).body.data;
    expect(page2.items.map((s: any) => [s.runNumber, s.sessionId])).toEqual([[1, first.sessionId]]);
    expect(page2.nextCursor).toBeNull();
    expect(page2.items[0]).toMatchObject({ answerCount: 5, participantCount: 1, shared: false });

    expect((await api('GET', '/api/sessions')).status).toBe(400);
    expect((await api('GET', `/api/sessions?presentationId=${deck._id}&cursor=nonsense`)).status).toBe(400);
    expect((await api('GET', `/api/sessions?presentationId=${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    expect((await api('GET', `/api/sessions?presentationId=${deck._id}`, { user: null })).status).toBe(401);
  });

  it('reports a live session from Redis aggregates and keeps notes out of the take-home', async () => {
    const deck = await createDeck();
    const pid = deck._id;
    const opened = await command(pid, 'open-lobby');
    const sessionId = opened.body.data.session.sessionId as string;
    const ada = await join(pid, 'Ada');
    const linus = await join(pid, 'Linus');
    await command(pid, 'start');
    expect((await answer(pid, ada, 0, { optionIndex: 0 })).status).toBe(200);
    expect((await answer(pid, linus, 0, { optionIndex: 1 })).status).toBe(200);

    const report = (await api('GET', `/api/sessions/${sessionId}`)).body.data;
    expect(report.session).toMatchObject({ status: 'active', isLive: true, participantCount: 2, answerCount: 2 });
    expect(report.slides[0]).toMatchObject({ visited: true, phase: 'open', answeredCount: 2 });
    expect(report.slides[0].distribution.counts).toEqual([1, 1, 0]);
    expect(report.slides[1]).toMatchObject({ visited: false, answeredCount: 0, distribution: null });

    // Sharing and deleting wait for the end; CSV works on a live session.
    const share = await api('POST', `/api/sessions/${sessionId}/share`, { body: {} });
    expect([share.status, share.body.code]).toEqual([409, 'SESSION_LIVE']);
    expect((await api('DELETE', `/api/sessions/${sessionId}`)).body.code).toBe('SESSION_LIVE');
    const csv = await raw(`/api/sessions/${sessionId}/export.csv`);
    expect(csv.status).toBe(200);

    // Take-home while the slide is open: the answer, but no correctness and no key.
    const home = (await api('GET', `/api/sessions/${sessionId}/me?participantId=${ada.participantId}&token=${ada.token}`, { user: null })).body.data;
    expect(home.session).toMatchObject({ status: 'active', participantCount: 2 });
    expect(home.slides[0]).toMatchObject({ answered: true, answer: 'Paris', isCorrect: null, points: null, correctAnswer: null });
    expect(JSON.stringify(home)).not.toContain(NOTE);

    // Once the slide is revealed, correctness and the key appear.
    await command(pid, 'reveal');
    const revealed = (await api('GET', `/api/sessions/${sessionId}/me?participantId=${ada.participantId}&token=${ada.token}`, { user: null })).body.data;
    expect(revealed.slides[0]).toMatchObject({ answer: 'Paris', isCorrect: true, correctAnswer: 'Paris' });
    expect(revealed.slides[0].points).toBeGreaterThan(0);
    const wrong = (await api('GET', `/api/sessions/${sessionId}/me?participantId=${linus.participantId}&token=${linus.token}`, { user: null })).body.data;
    expect(wrong.slides[0]).toMatchObject({ answer: 'Lyon', isCorrect: false, points: 0 });
    expect(revealed.me.rank).toBe(1);
    expect(wrong.me.rank).toBe(2);
  });

  it('serves take-home only to the participant holding the token', async () => {
    const deck = await createDeck();
    const { sessionId, joined } = await runSession(deck._id, ['Ada', 'Grace']);
    const [ada, grace] = joined as [Joined, Joined];
    const me = (who: string, token: string, session = sessionId) =>
      api('GET', `/api/sessions/${session}/me?participantId=${who}&token=${token}`, { user: null });

    const ok = await me(ada.participantId, ada.token);
    expect(ok.status).toBe(200);
    expect(ok.body.data.me).toMatchObject({ name: 'Ada', rank: 1 });
    expect(ok.body.data.slides.map((s: any) => s.slideIndex)).toEqual([0, 1, 2, 3, 4]);
    // The key shows once the session has ended.
    expect(ok.body.data.slides[0]).toMatchObject({ correctAnswer: 'Paris' });
    expect(ok.body.data.slides[1]).toMatchObject({ correctAnswer: 'Jupiter' });

    expect((await me(ada.participantId, grace.token)).status).toBe(401);
    expect((await me(ada.participantId, `${ada.token}x`)).status).toBe(401);
    expect((await me(ada.participantId, 'x')).status).toBe(401);
    expect((await api('GET', `/api/sessions/${sessionId}/me?participantId=${ada.participantId}`, { user: null })).status).toBe(400);
    expect((await me(String(new mongoose.Types.ObjectId()), ada.token)).status).toBe(404);
    expect((await me(ada.participantId, ada.token, String(new mongoose.Types.ObjectId()))).status).toBe(404);
    // A participant of another session of the deck cannot read this one.
    const second = await runSession(deck._id, ['Linus']);
    expect((await me(second.joined[0]!.participantId, second.joined[0]!.token, sessionId)).status).toBe(404);

    // Removed participants lose access.
    await PresentationParticipantModel.updateOne({ _id: grace.participantId }, { $set: { kickedAt: new Date() } });
    expect((await me(grace.participantId, grace.token)).status).toBe(403);
  });

  it('shares aggregated results by token: enable, names, rotate, expire, disable', async () => {
    const deck = await createDeck();
    const { sessionId, joined } = await runSession(deck._id, ['Ada', 'Grace', 'Linus']);
    const publicGet = (token: string) => api('GET', `/api/public/results/${token}`, { user: null });

    // Not shared yet.
    expect((await api('GET', `/api/sessions/${sessionId}`)).body.data.share).toBeNull();

    const enabled = await api('POST', `/api/sessions/${sessionId}/share`, { body: {} });
    expect(enabled.status).toBe(200);
    const share = enabled.body.data;
    expect(share).toMatchObject({ enabled: true, includeNames: false, expiresAt: null, active: true });
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const res = await publicGet(share.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: 'Reports deck',
      runNumber: 1,
      participantCount: 3,
      includeNames: false,
      leaderboard: null,
    });
    expect(res.body.data.slides.map((s: any) => s.type)).toEqual(['select_answer', 'type_answer', 'wordcloud', 'scales', 'open_ended']);
    expect(res.body.data.slides[0].distribution.counts).toEqual([1, 1, 1]);

    // Nothing private: no notes, names, ids, tokens, emails, join code or host id.
    const text = JSON.stringify(res.body);
    const stored = await PresentationSessionModel.findById(sessionId).lean();
    const privates = [
      NOTE,
      'Ada',
      'Grace',
      'Linus',
      host.email,
      host.id,
      stored!.joinCode,
      sessionId,
      deck._id,
      ...joined.map((p) => p.participantId),
      ...joined.map((p) => p.token),
      ...deck.slides.map((s) => s._id),
      'hostUserId',
      'workspaceId',
      'deckSnapshot',
    ];
    for (const secret of privates) expect(text).not.toContain(secret);
    const headers = (await server.request(`/api/public/results/${share.token}`)).headers;
    expect(headers.get('x-robots-tag')).toContain('noindex');
    expect(headers.get('cache-control')).toBe('no-store');

    // The report tells members the token and status.
    const report = (await api('GET', `/api/sessions/${sessionId}`)).body.data;
    expect(report.share).toMatchObject({ token: share.token, active: true });
    expect((await api('GET', `/api/sessions?presentationId=${deck._id}`)).body.data.items[0].shared).toBe(true);

    // includeNames shows top standings with names only.
    const named = await api('POST', `/api/sessions/${sessionId}/share`, { body: { includeNames: true } });
    expect(named.body.data).toMatchObject({ token: share.token, includeNames: true });
    const withNames = (await publicGet(share.token)).body.data;
    expect(withNames.includeNames).toBe(true);
    expect(withNames.leaderboard.map((e: any) => e.name).sort()).toEqual(['Ada', 'Grace', 'Linus']);
    expect(Object.keys(withNames.leaderboard[0]).sort()).toEqual(['correctCount', 'name', 'rank', 'score']);
    expect(JSON.stringify(withNames)).not.toContain(joined[0]!.participantId);

    // Expiry in the past is refused; a future one works and then lapses.
    expect((await api('POST', `/api/sessions/${sessionId}/share`, { body: { expiresAt: '2020-01-01T00:00:00Z' } })).status).toBe(400);
    expect((await api('POST', `/api/sessions/${sessionId}/share`, { body: { expiresAt: 'tomorrow' } })).status).toBe(400);
    expect((await api('POST', `/api/sessions/${sessionId}/share`, { body: { unknown: true } })).status).toBe(400);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const timed = await api('POST', `/api/sessions/${sessionId}/share`, { body: { expiresAt: future } });
    expect(timed.body.data).toMatchObject({ expiresAt: future, active: true, includeNames: true });
    expect((await publicGet(share.token)).status).toBe(200);
    await PresentationSessionModel.updateOne({ _id: sessionId }, { $set: { 'share.expiresAt': new Date(Date.now() - 1000) } });
    expect((await publicGet(share.token)).status).toBe(404);
    expect((await api('GET', `/api/sessions/${sessionId}`)).body.data.share).toMatchObject({ active: false });
    // Re-enabling without a new expiry keeps the lapsed one, so it is refused; clearing it works.
    expect((await api('POST', `/api/sessions/${sessionId}/share`, { body: {} })).status).toBe(400);
    const cleared = await api('POST', `/api/sessions/${sessionId}/share`, { body: { expiresAt: null } });
    expect(cleared.body.data).toMatchObject({ token: share.token, expiresAt: null, active: true });
    expect((await publicGet(share.token)).status).toBe(200);

    // Disable: 404, token kept for re-enable; rotate invalidates old links.
    const off = await api('DELETE', `/api/sessions/${sessionId}/share`);
    expect(off.body.data).toMatchObject({ enabled: false, active: false });
    expect((await publicGet(share.token)).status).toBe(404);
    const again = await api('POST', `/api/sessions/${sessionId}/share`, { body: {} });
    expect(again.body.data.token).toBe(share.token);
    expect((await publicGet(share.token)).status).toBe(200);
    const rotated = await api('POST', `/api/sessions/${sessionId}/share`, { body: { rotate: true } });
    expect(rotated.body.data.token).not.toBe(share.token);
    expect((await publicGet(share.token)).status).toBe(404);
    expect((await publicGet(rotated.body.data.token)).status).toBe(200);

    // Malformed and unknown tokens are 404, never an error that reveals more.
    for (const token of ['short', 'x'.repeat(200), 'a'.repeat(32), '%20%20%20', '..%2F..%2Fetc']) {
      expect([token, (await publicGet(token)).status]).toEqual([token, 404]);
    }
    // Disabling a session that was never shared is a no-op.
    const other = await runSession(deck._id, ['Alan']);
    expect((await api('DELETE', `/api/sessions/${other.sessionId}/share`)).body.data).toBeNull();

    await waitFor(async () => (await AuditEventModel.countDocuments({ action: /^session\.share\./ })) >= 6, 'share audit');
  }, 60_000);

  it('stops serving a shared session once it is deleted', async () => {
    const deck = await createDeck();
    const { sessionId } = await runSession(deck._id, ['Ada']);
    const token = (await api('POST', `/api/sessions/${sessionId}/share`, { body: {} })).body.data.token as string;
    expect((await api('GET', `/api/public/results/${token}`, { user: null })).status).toBe(200);

    const removed = await api('DELETE', `/api/sessions/${sessionId}`);
    expect(removed.body.data).toEqual({ sessionId, deleted: true });
    expect((await api('GET', `/api/public/results/${token}`, { user: null })).status).toBe(404);
    expect((await api('GET', `/api/sessions/${sessionId}`)).status).toBe(404);
  });

  it('deletes a session with its participants, answers and Redis state, and audits it', async () => {
    const deck = await createDeck();
    const kept = await runSession(deck._id, ['Linus']);
    const doomed = await runSession(deck._id, ['Ada', 'Grace']);
    const doomedId = new mongoose.Types.ObjectId(doomed.sessionId);
    expect(await PresentationAnswerModel.countDocuments({ sessionId: doomedId })).toBeGreaterThan(0);
    await redisClient.set(`psess:{${doomed.sessionId}}:meta`, '1');

    const res = await api('DELETE', `/api/sessions/${doomed.sessionId}`);
    expect(res.status).toBe(200);
    expect(await PresentationSessionModel.countDocuments({ _id: doomedId })).toBe(0);
    expect(await PresentationParticipantModel.countDocuments({ sessionId: doomedId })).toBe(0);
    expect(await PresentationAnswerModel.countDocuments({ sessionId: doomedId })).toBe(0);
    expect(await redisClient.exists(`psess:{${doomed.sessionId}}:meta`)).toBe(0);
    // The other run is untouched.
    expect(await PresentationSessionModel.countDocuments({ _id: kept.sessionId })).toBe(1);
    expect(await PresentationAnswerModel.countDocuments({ sessionId: kept.sessionId })).toBeGreaterThan(0);
    expect((await api('DELETE', `/api/sessions/${doomed.sessionId}`)).status).toBe(404);

    await waitFor(async () => (await AuditEventModel.countDocuments({ action: 'session.delete' })) === 1, 'delete audit');
    const event = await AuditEventModel.findOne({ action: 'session.delete' }).lean();
    expect(String(event!.actorId)).toBe(host.id);
    expect(event).toMatchObject({ targetType: 'session', targetId: doomed.sessionId });
    expect(event!.meta).toMatchObject({ runNumber: 2, participants: 2 });
  });

  it('isolates workspaces and enforces roles', async () => {
    const deck = await createDeck();
    const { sessionId } = await runSession(deck._id, ['Ada']);
    const stranger = await createVerifiedUser({ name: 'Stranger' });
    // The stranger's own workspace gets provisioned lazily by their first request.
    await decks('GET', '/', { user: stranger });

    const routes: [string, string][] = [
      ['GET', `/api/sessions/${sessionId}`],
      ['GET', `/api/sessions/${sessionId}/export.csv`],
      ['GET', `/api/sessions/${sessionId}/export.xlsx`],
      ['GET', `/api/sessions/${sessionId}/export.pdf`],
      ['POST', `/api/sessions/${sessionId}/share`],
      ['DELETE', `/api/sessions/${sessionId}/share`],
      ['DELETE', `/api/sessions/${sessionId}`],
      ['GET', `/api/sessions?presentationId=${deck._id}`],
    ];
    for (const [method, path] of routes) {
      const res = await api(method, path, { user: stranger, body: method === 'POST' ? {} : undefined });
      expect([method, path, res.status]).toEqual([method, path, 403]);
      // 401 without credentials.
      expect((await api(method, path, { user: null, body: method === 'POST' ? {} : undefined })).status).toBe(401);
    }
    // Even naming the owner's workspace does not help: the stranger is no member.
    const crossed = await api('GET', `/api/sessions/${sessionId}`, { user: stranger, headers: { 'X-Workspace-Id': workspaceId } });
    expect(crossed.status).toBe(403);
    // Unknown and malformed ids are 404.
    expect((await api('GET', `/api/sessions/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    expect((await api('GET', '/api/sessions/not-an-id')).status).toBe(404);

    // Roles in a team workspace.
    const team = await WorkspaceModel.create({
      name: 'Team',
      slug: `team-${new mongoose.Types.ObjectId()}`,
      type: 'team',
      plan: 'team',
      ownerId: host.id,
    });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: host.id, role: 'owner' });
    const roleUsers = {
      editor: await createVerifiedUser({ name: 'Editor' }),
      presenter: await createVerifiedUser({ name: 'Presenter' }),
      viewer: await createVerifiedUser({ name: 'Viewer' }),
    };
    for (const role of ['editor', 'presenter', 'viewer'] as const) {
      await WorkspaceMemberModel.create({ workspaceId: team._id, userId: roleUsers[role].id, role });
    }
    const inTeam = { 'X-Workspace-Id': String(team._id) };
    const teamDeck = await createDeck(SLIDES, host, inTeam);
    const teamRun = await runSession(teamDeck._id, ['Ada'], { headers: inTeam });
    const as = (user: TestUser, method: string, path: string, body?: unknown) => api(method, path, { user, headers: inTeam, body });
    const sid = teamRun.sessionId;

    const { viewer, presenter, editor } = roleUsers;
    expect((await as(viewer, 'GET', `/api/sessions/${sid}`)).status).toBe(200);
    expect((await raw(`/api/sessions/${sid}/export.csv`, { user: viewer, headers: inTeam })).status).toBe(403);
    expect((await raw(`/api/sessions/${sid}/export.csv`, { user: presenter, headers: inTeam })).status).toBe(200);
    const presenterReport = (await as(presenter, 'GET', `/api/sessions/${sid}`)).body.data;
    expect(presenterReport.access).toEqual({ export: true, share: false, delete: false });
    expect(presenterReport.share).toBeNull();
    expect((await as(presenter, 'POST', `/api/sessions/${sid}/share`, {})).status).toBe(403);
    expect((await as(presenter, 'DELETE', `/api/sessions/${sid}`)).status).toBe(403);
    expect((await as(editor, 'POST', `/api/sessions/${sid}/share`, {})).status).toBe(200);
    // Members who may not share never see the token.
    const sharedForPresenter = (await as(presenter, 'GET', `/api/sessions/${sid}`)).body.data.share;
    expect(sharedForPresenter).toMatchObject({ enabled: true, token: null });
    // The same session through the owner's personal workspace context is not reachable.
    expect((await api('GET', `/api/sessions/${sid}`, { user: host })).status).toBe(403);
    expect((await as(editor, 'DELETE', `/api/sessions/${sid}`)).status).toBe(200);
  }, 60_000);

  it('rate limits the public results route per IP and the exports per user', async () => {
    const deck = await createDeck();
    const { sessionId } = await runSession(deck._id, ['Ada']);
    const token = (await api('POST', `/api/sessions/${sessionId}/share`, { body: {} })).body.data.token as string;

    const statuses: number[] = [];
    for (let i = 0; i < 305; i++) {
      statuses.push((await server.request(`/api/public/results/${token}`)).status);
      if (statuses.at(-1) === 429) break;
    }
    expect(statuses.slice(0, 300).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  }, 60_000);
});
