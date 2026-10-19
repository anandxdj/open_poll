#!/usr/bin/env bun
/**
 * Answer storm: N participants answer a live deck, slide after slide, through
 * the real backend (REST, Socket.io or both), and the run is judged against
 * throughput and latency thresholds. It also checks that nothing was lost: the
 * answers Redis accepted must all reach Mongo, and the session totals must add up.
 *
 *   cd backend
 *   bun loadtest/answer-storm.ts --spawn                 # start a server, storm it, stop it
 *   bun loadtest/answer-storm.ts --base-url http://127.0.0.1:5000 --mode socket
 *   bun loadtest/answer-storm.ts --spawn --mode mixed --participants 1000 --rate 2000
 *   bun loadtest/answer-storm.ts --prepare-only --participants 5000   # fixture for answer-rest.k6.js
 *
 * Flags (each also reads an env var, flags win):
 *   --mode rest|socket|mixed     STORM_MODE           channel of the answers            (rest)
 *   --participants N             STORM_PARTICIPANTS   virtual phones                    (600)
 *   --slides N                   STORM_SLIDES         slides answered one after another (10)
 *   --rate N                     STORM_RATE           answers/s offered; 0 = burst      (600)
 *   --min-rps N                  STORM_MIN_RPS        fail below this accepted rate     (500)
 *   --max-p95-ms N               STORM_MAX_P95_MS     fail above this p95 latency       (150)
 *   --base-url URL               STORM_BASE_URL       server to storm (default: --spawn)
 *   --spawn                      STORM_SPAWN=1        run `bun src/app.ts` on a free port
 *   --json PATH                  STORM_JSON           write the summary as JSON
 *   --prepare-only               STORM_PREPARE_ONLY   write the k6 fixture and stop
 *   --fixture PATH               STORM_FIXTURE        fixture path (loadtest/.fixture.json)
 *
 * The script needs the same MONGO_URI / REDIS_URL / JWT secrets as the server
 * (it creates the host account in Mongo, like tests/integration/fixtures.ts) and
 * must run from backend/. It points at whatever those variables say, so aim it
 * at throwaway services, never at a shared database.
 *
 * Latency is measured open loop: from the moment an answer was SUPPOSED to be
 * sent, so a slow server cannot hide behind a slow client. Each virtual phone
 * sends its own X-Forwarded-For (the server trusts one proxy hop), which makes
 * the per-IP rate limits behave like a room of real phones instead of one
 * machine hammering one address.
 */
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { generateAccessToken } from '../src/common/utils/jwt.utils';
import { UserModel } from '../src/modules/auth/auth.model';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';
import {
  PresentationAnswerModel,
  PresentationParticipantModel,
} from '../src/modules/presentations/presentations.model';

// Bun caps in-flight fetches at 256 by default, which would queue a burst on the client side.
if (!process.env.BUN_CONFIG_MAX_HTTP_REQUESTS) {
  const child = Bun.spawn([process.execPath, ...process.argv.slice(1)], {
    env: { ...process.env, BUN_CONFIG_MAX_HTTP_REQUESTS: '4096' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exit(await child.exited);
}

const { values: flags } = parseArgs({
  options: {
    mode: { type: 'string' },
    participants: { type: 'string' },
    slides: { type: 'string' },
    rate: { type: 'string' },
    'min-rps': { type: 'string' },
    'max-p95-ms': { type: 'string' },
    'base-url': { type: 'string' },
    spawn: { type: 'boolean' },
    json: { type: 'string' },
    'prepare-only': { type: 'boolean' },
    fixture: { type: 'string' },
  },
});

const pick = (flag: string | undefined, env: string, fallback: string) => flag ?? process.env[env] ?? fallback;
const num = (flag: string | undefined, env: string, fallback: number) => Number(pick(flag, env, String(fallback)));

const MODE = pick(flags.mode, 'STORM_MODE', 'rest') as 'rest' | 'socket' | 'mixed';
const PARTICIPANTS = num(flags.participants, 'STORM_PARTICIPANTS', 600);
const SLIDES = num(flags.slides, 'STORM_SLIDES', 10);
const RATE = num(flags.rate, 'STORM_RATE', 600);
const MIN_RPS = num(flags['min-rps'], 'STORM_MIN_RPS', 500);
const MAX_P95_MS = num(flags['max-p95-ms'], 'STORM_MAX_P95_MS', 150);
const SPAWN = flags.spawn ?? process.env.STORM_SPAWN === '1';
const PREPARE_ONLY = flags['prepare-only'] ?? process.env.STORM_PREPARE_ONLY === '1';
const JSON_OUT = flags.json ?? process.env.STORM_JSON;
const FIXTURE = pick(flags.fixture, 'STORM_FIXTURE', join(import.meta.dir, '.fixture.json'));
let baseUrl = pick(flags['base-url'], 'STORM_BASE_URL', '');

if (!['rest', 'socket', 'mixed'].includes(MODE)) throw new Error(`--mode must be rest, socket or mixed (got ${MODE})`);
if (!SPAWN && !baseUrl) throw new Error('Pass --spawn to start a server, or --base-url of a running one.');
if (PARTICIPANTS < 1 || SLIDES < 1) throw new Error('--participants and --slides must be at least 1');

// ---------------------------------------------------------------------------

const log = (message: string) => console.log(`[storm] ${message}`);
const sleep = (ms: number) => Bun.sleep(ms);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

const phoneIp = (index: number) => `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${(index & 255) || 1}`;

/** Runs `worker` over `items` with at most `limit` in flight. */
const pool = async <T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index]!, index);
      }
    })
  );
};

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.spawn> | null = null;
let serverLog = '';
const METRICS_TOKEN = process.env.METRICS_TOKEN ?? 'storm-metrics-token-0123456789';

const startServer = async () => {
  const port = Number(process.env.STORM_PORT ?? (await freePort()));
  mkdirSync(tmpdir(), { recursive: true });
  serverLog = join(tmpdir(), `openpoll-storm-server-${port}.log`);
  const out = openSync(serverLog, 'w');
  server = Bun.spawn([process.execPath, 'src/app.ts'], {
    cwd: join(import.meta.dir, '..'),
    env: { ...process.env, PORT: String(port), METRICS_TOKEN },
    stdout: out,
    stderr: out,
  });
  baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`The spawned server exited early; see ${serverLog}`);
    try {
      const ready = await fetch(`${baseUrl}/ready`);
      if (ready.status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`The spawned server was not ready in 60 s; see ${serverLog}`);
};

const stopServer = async () => {
  if (!server) return;
  server.kill();
  await Promise.race([server.exited, sleep(5000)]);
};

// ---------------------------------------------------------------------------
// Fixture: host, deck, session, phones
// ---------------------------------------------------------------------------

interface Phone {
  participantId: string;
  token: string;
  ip: string;
  /** Which option this phone taps. */
  choice: number;
}

const api = async (path: string, init: { method?: string; token?: string; body?: unknown; ip?: string } = {}) => {
  const res = await fetch(`${baseUrl}/api/presentations${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.ip ? { 'x-forwarded-for': init.ip } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { data?: any; message?: string; code?: string };
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${body.code ?? ''} ${body.message ?? ''}`);
  return body.data;
};

const prepare = async () => {
  await mongoose.connect(process.env.MONGO_URI ?? (await import('../src/common/config/env')).env.MONGO_URI);
  const email = `storm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const user = await UserModel.create({ email, name: 'Storm Host', password: 'Correct-Horse-9', role: 'user', isVerified: true });
  const token = generateAccessToken({ id: user._id, email: user.email, name: user.name, role: 'user' });

  const slides = Array.from({ length: SLIDES }, (_, i) => ({
    type: 'select_answer',
    question: `Storm question ${i + 1}`,
    options: [
      { text: 'A', isCorrect: true },
      { text: 'B', isCorrect: false },
      { text: 'C', isCorrect: false },
    ],
    timeLimit: 120,
  }));
  const deck = await api('/', { method: 'POST', token, body: { title: `Answer storm ${new Date().toISOString()}`, slides } });
  // The free plan caps a session at 100 phones; a storm needs the room.
  await WorkspaceModel.updateOne({ _id: deck.workspaceId }, { $set: { plan: 'enterprise', planOverrides: { limits: { audienceCap: null } } } });

  const lobby = await api(`/${deck._id}/host/open-lobby`, { method: 'POST', token });
  const phones: Phone[] = new Array(PARTICIPANTS);
  const joinedAt = performance.now();
  await pool(Array.from({ length: PARTICIPANTS }), 100, async (_, i) => {
    const joined = await api(`/${deck._id}/join`, { method: 'POST', body: { name: `Phone ${i + 1}` }, ip: phoneIp(i) });
    phones[i] = { participantId: joined.participantId, token: joined.token, ip: phoneIp(i), choice: i % 3 };
  });
  log(`${PARTICIPANTS} phones joined in ${Math.round(performance.now() - joinedAt)} ms`);
  return {
    token,
    presentationId: String(deck._id) as string,
    sessionId: String(lobby.session.sessionId) as string,
    slideIds: deck.slides.map((s: { _id: string }) => String(s._id)) as string[],
    phones,
  };
};

type Fixture = Awaited<ReturnType<typeof prepare>>;

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

interface Outcome {
  ok: boolean;
  status: number;
  /** ms from the moment the answer was due to the reply. */
  ms: number;
}

const restAnswer = async (fx: Fixture, phone: Phone, slideIndex: number, due: number): Promise<Outcome> => {
  try {
    const res = await fetch(`${baseUrl}/api/presentations/${fx.presentationId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': phone.ip },
      body: JSON.stringify({
        participantId: phone.participantId,
        participantToken: phone.token,
        sessionId: fx.sessionId,
        slideId: fx.slideIds[slideIndex],
        slideIndex,
        optionIndex: phone.choice,
        clientAnswerId: `${phone.participantId}-${slideIndex}`,
      }),
    });
    await res.arrayBuffer();
    return { ok: res.status === 200, status: res.status, ms: performance.now() - due };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - due };
  }
};

const socketAnswer = async (fx: Fixture, socket: ClientSocket, phone: Phone, slideIndex: number, due: number): Promise<Outcome> => {
  try {
    const ack = (await socket.timeout(10_000).emitWithAck('answer:submit', {
      presentationId: fx.presentationId,
      participantId: phone.participantId,
      participantToken: phone.token,
      sessionId: fx.sessionId,
      slideId: fx.slideIds[slideIndex],
      slideIndex,
      optionIndex: phone.choice,
      clientAnswerId: `${phone.participantId}-${slideIndex}`,
    })) as { success: boolean; status: number };
    return { ok: ack.success === true, status: ack.status, ms: performance.now() - due };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - due };
  }
};

const connectSockets = async (fx: Fixture, count: number) => {
  const sockets: (ClientSocket | null)[] = new Array(count).fill(null);
  await pool(Array.from({ length: count }), 100, async (_, i) => {
    const socket = connectClient(baseUrl, { transports: ['websocket'], forceNew: true, extraHeaders: { 'x-forwarded-for': phoneIp(i) } });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    // A socket answers only as a participant it joined, like a phone that opened the live page.
    const phone = fx.phones[i]!;
    const joined = (await socket.timeout(10_000).emitWithAck('live:join', {
      presentationId: fx.presentationId,
      role: 'participant',
      participantId: phone.participantId,
      participantToken: phone.token,
    })) as { ok: boolean };
    if (!joined.ok) throw new Error(`live:join refused for phone ${i}`);
    sockets[i] = socket;
  });
  return sockets as ClientSocket[];
};

/** Fires `count` jobs at `rate`/s (0 = all at once) and reports each one's outcome. */
const openLoop = async (count: number, rate: number, fire: (index: number, due: number) => Promise<Outcome>) => {
  const outcomes: Outcome[] = new Array(count);
  const start = performance.now();
  const inFlight: Promise<void>[] = [];
  let launched = 0;
  while (launched < count) {
    const due = rate > 0 ? Math.min(count, Math.floor(((performance.now() - start) / 1000) * rate) + 1) : count;
    while (launched < due) {
      const index = launched++;
      const scheduled = rate > 0 ? start + (index / rate) * 1000 : start;
      inFlight.push(fire(index, scheduled).then((outcome) => void (outcomes[index] = outcome)));
    }
    if (launched < count) await sleep(2);
  }
  await Promise.all(inFlight);
  return { outcomes, wallMs: performance.now() - start };
};

// ---------------------------------------------------------------------------
// Server-side numbers (when /metrics is reachable)
// ---------------------------------------------------------------------------

const scrapeAnswerLatency = async () => {
  try {
    const res = await fetch(`${baseUrl}/metrics`, { headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
    if (res.status !== 200) return null;
    const text = await res.text();
    const buckets = new Map<number, number>();
    let count = 0;
    for (const line of text.split('\n')) {
      if (!line.startsWith('openpoll_answer_duration_seconds')) continue;
      const value = Number(line.slice(line.lastIndexOf(' ') + 1));
      const le = /le="([^"]+)"/.exec(line)?.[1];
      if (line.startsWith('openpoll_answer_duration_seconds_bucket') && le) {
        const bound = le === '+Inf' ? Infinity : Number(le);
        buckets.set(bound, (buckets.get(bound) ?? 0) + value);
      } else if (line.startsWith('openpoll_answer_duration_seconds_count')) count += value;
    }
    if (count === 0) return null;
    const bounds = [...buckets.keys()].sort((a, b) => a - b);
    const p95 = bounds.find((bound) => (buckets.get(bound) ?? 0) >= count * 0.95);
    return { answers: count, p95Ms: p95 === undefined || p95 === Infinity ? null : p95 * 1000 };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------

const main = async () => {
  if (SPAWN) {
    log('starting a backend');
    await startServer();
  }
  log(`target ${baseUrl}  mode=${MODE}  participants=${PARTICIPANTS}  slides=${SLIDES}  rate=${RATE || 'burst'}`);
  const fx = await prepare();

  if (PREPARE_ONLY) {
    writeFileSync(
      FIXTURE,
      JSON.stringify({ baseUrl, ...fx, phones: fx.phones, slideIndex: 0 }, null, 2)
    );
    await api(`/${fx.presentationId}/host/goto`, { method: 'POST', token: fx.token, body: { slideIndex: 0 } });
    log(`k6 fixture written to ${FIXTURE}; slide 0 is open. Run: k6 run loadtest/answer-rest.k6.js`);
    return 0;
  }

  const wantSockets = MODE === 'socket' ? PARTICIPANTS : MODE === 'mixed' ? Math.ceil(PARTICIPANTS / 2) : 0;
  const sockets = wantSockets > 0 ? await connectSockets(fx, wantSockets) : [];
  const viaSocket = (phoneIndex: number) => phoneIndex < sockets.length;

  const all: Outcome[] = [];
  let answerWallMs = 0;
  for (let slide = 0; slide < SLIDES; slide += 1) {
    await api(`/${fx.presentationId}/host/goto`, { method: 'POST', token: fx.token, body: { slideIndex: slide } });
    const { outcomes, wallMs } = await openLoop(PARTICIPANTS, RATE, (i, due) =>
      viaSocket(i) ? socketAnswer(fx, sockets[i]!, fx.phones[i]!, slide, due) : restAnswer(fx, fx.phones[i]!, slide, due)
    );
    all.push(...outcomes);
    answerWallMs += wallMs;
    const failed = outcomes.filter((o) => !o.ok).length;
    log(`slide ${slide + 1}/${SLIDES}: ${outcomes.length - failed} accepted, ${failed} failed, ${Math.round(wallMs)} ms`);
  }
  for (const socket of sockets) socket.disconnect();

  // Durability: every accepted answer must reach Mongo, and the totals must add up.
  const accepted = all.filter((o) => o.ok).length;
  const deadline = Date.now() + 30_000;
  let stored = 0;
  while (Date.now() < deadline) {
    stored = await PresentationAnswerModel.countDocuments({ sessionId: fx.sessionId });
    if (stored >= accepted) break;
    await sleep(250);
  }
  const ended = await api(`/${fx.presentationId}/host/end`, { method: 'POST', token: fx.token });
  const storedAfterEnd = await PresentationAnswerModel.countDocuments({ sessionId: fx.sessionId });
  const totals = await PresentationAnswerModel.aggregate<{ _id: null; score: number }>([
    { $match: { sessionId: new mongoose.Types.ObjectId(fx.sessionId) } },
    { $group: { _id: null, score: { $sum: '$score' } } },
  ]);
  const participantScores = await PresentationParticipantModel.aggregate<{ _id: null; score: number }>([
    { $match: { sessionId: new mongoose.Types.ObjectId(fx.sessionId) } },
    { $group: { _id: null, score: { $sum: '$score' } } },
  ]);
  const serverSide = await scrapeAnswerLatency();

  const latencies = all.filter((o) => o.ok).map((o) => o.ms).sort((a, b) => a - b);
  const summary = {
    mode: MODE,
    participants: PARTICIPANTS,
    slides: SLIDES,
    offeredRate: RATE || 'burst',
    answersSent: all.length,
    accepted,
    failed: all.length - accepted,
    failures: Object.fromEntries(
      [...new Set(all.filter((o) => !o.ok).map((o) => o.status))].map((status) => [status, all.filter((o) => !o.ok && o.status === status).length])
    ),
    acceptedPerSecond: Math.round(accepted / (answerWallMs / 1000)),
    latencyMs: {
      p50: +percentile(latencies, 50).toFixed(1),
      p95: +percentile(latencies, 95).toFixed(1),
      p99: +percentile(latencies, 99).toFixed(1),
      max: +(latencies.at(-1) ?? 0).toFixed(1),
    },
    serverSide,
    storedInMongo: storedAfterEnd,
    sessionAnswerCount: ended.session.answerCount,
    scoreInAnswers: totals[0]?.score ?? 0,
    scoreInParticipants: participantScores[0]?.score ?? 0,
    thresholds: { minRps: MIN_RPS, maxP95Ms: MAX_P95_MS },
  };

  const problems: string[] = [];
  if (summary.failed > 0) problems.push(`${summary.failed} answers failed (${JSON.stringify(summary.failures)})`);
  if (summary.acceptedPerSecond < MIN_RPS) problems.push(`throughput ${summary.acceptedPerSecond}/s is below ${MIN_RPS}/s`);
  if (summary.latencyMs.p95 > MAX_P95_MS) problems.push(`p95 ${summary.latencyMs.p95} ms is above ${MAX_P95_MS} ms`);
  if (stored < accepted) problems.push(`only ${stored} of ${accepted} accepted answers reached Mongo in 30 s`);
  if (storedAfterEnd !== accepted) problems.push(`Mongo holds ${storedAfterEnd} answers after the session ended, expected ${accepted}`);
  if (summary.sessionAnswerCount !== accepted) problems.push(`the session reports ${summary.sessionAnswerCount} answers, expected ${accepted}`);
  if (summary.scoreInAnswers !== summary.scoreInParticipants) {
    problems.push(`participant scores (${summary.scoreInParticipants}) differ from answer scores (${summary.scoreInAnswers})`);
  }

  console.log(JSON.stringify({ ...summary, problems }, null, 2));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ ...summary, problems }, null, 2));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[storm] FAIL: ${problem}`);
    if (serverLog) console.error(`[storm] server log: ${serverLog}`);
    return 1;
  }
  log(`PASS: ${summary.acceptedPerSecond} answers/s, p95 ${summary.latencyMs.p95} ms`);
  return 0;
};

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error('[storm] error:', error);
} finally {
  await mongoose.disconnect().catch(() => {});
  await stopServer();
}
process.exit(code);
