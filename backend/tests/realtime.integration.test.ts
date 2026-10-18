/**
 * Realtime integration test: real Redis and Mongo, two Socket.io servers (two
 * "instances" sharing one Redis) on port 0, and socket.io-client sockets that
 * join through both the legacy `quiz:join` and the new `live:join`. Events are
 * produced by the real presentations service.
 *
 * Skipped unless TEST_REDIS_URL and TEST_MONGO_URI are both set. Point them at
 * dedicated test databases — never at a dev or shared instance. The test deletes
 * only the documents and keys it creates.
 *
 *   docker run -d --name openpoll-test-redis -p 127.0.0.1:6390:6379 redis:7-alpine
 *   docker run -d --name openpoll-test-mongo -p 127.0.0.1:27117:27017 mongo:7
 *
 *   cd backend
 *   TEST_REDIS_URL=redis://127.0.0.1:6390/2 \
 *   TEST_MONGO_URI='mongodb://127.0.0.1:27117/openpoll_w0b?directConnection=true' \
 *   bun test tests/realtime.integration.test.ts
 *
 * The shared `redisClient` reads REDIS_URL when it is first imported. When an
 * earlier test file in the same `bun test` run imported it with another URL, this
 * file re-runs itself in a child process with REDIS_URL=TEST_REDIS_URL rather
 * than connect that client anywhere else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const TEST_MONGO_URI = process.env.TEST_MONGO_URI;
const enabled = Boolean(TEST_REDIS_URL && TEST_MONGO_URI);

const previousRedisUrl = process.env.REDIS_URL;
if (enabled) process.env.REDIS_URL = TEST_REDIS_URL;
const { redisClient } = await import('../src/common/config/redis');
if (enabled) {
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousRedisUrl;
}

const inProcess = enabled && redisClient.options?.url === TEST_REDIS_URL;

// App modules load after REDIS_URL is settled. Importing them opens no connection.
const mongoose = (await import('mongoose')).default;
const { Server } = await import('socket.io');
const { setupSocketAndPubSub } = await import('../src/common/realtime/socket');
const { publishLiveEvent, liveSeqKey } = await import('../src/common/realtime/publish');
const { generateAccessToken } = await import('../src/common/utils/jwt.utils');
const { createPresentationSchema } = await import('../src/modules/presentations/presentations.schema');
const { PresentationService } = await import('../src/modules/presentations/presentations.service');
const { PresentationModel, PresentationParticipantModel, PresentationAnswerModel, PresentationSessionModel } =
  await import('../src/modules/presentations/presentations.model');

describe.skipIf(!enabled || inProcess)('realtime integration (isolated process)', () => {
  it('passes in a process whose Redis client points at TEST_REDIS_URL', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, REDIS_URL: TEST_REDIS_URL, MONGO_URI: TEST_MONGO_URI },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    expect(await child.exited).toBe(0);
  }, 60_000);
});

type Envelope = {
  v: number;
  presentationId: string;
  sessionId: string | null;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  audience: string;
  emittedAt: string;
  quizId: string;
};

interface Client {
  name: string;
  socket: ClientSocket;
  live: Envelope[];
  legacy: Envelope[];
}

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

describe.skipIf(!inProcess)('realtime integration', () => {
  const servers: Array<{ io: InstanceType<typeof Server>; http: HttpServer; close: () => Promise<void>; url: string }> =
    [];
  const clients: Client[] = [];
  const hostId = new mongoose.Types.ObjectId().toString();
  const hostToken = generateAccessToken({ id: hostId, email: 'host@example.com', name: 'Host', role: 'user' });
  let presentationId = '';
  let participants: Record<'alice' | 'bob' | 'carol', { participantId: string; token: string }>;
  let baselineSeq = 0;
  // The smoke test pins `redisClient.isOpen` to true; lift that while this file owns the client.
  let pinnedIsOpen: PropertyDescriptor | undefined;

  const startServer = async () => {
    const http = createServer();
    const io = new Server(http);
    const realtime = await setupSocketAndPubSub(io);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const { port } = http.address() as AddressInfo;
    servers.push({ io, http, close: realtime.close, url: `http://127.0.0.1:${port}` });
  };

  const connect = async (name: string, server: number, auth?: Record<string, unknown>) => {
    const socket = connectClient(servers[server]!.url, { transports: ['websocket'], forceNew: true, auth });
    const client: Client = { name, socket, live: [], legacy: [] };
    socket.on('live:event', (event: Envelope) => client.live.push(event));
    socket.on('quiz:event', (event: Envelope) => client.legacy.push(event));
    clients.push(client);
    await waitFor(() => socket.connected, `${name} to connect`);
    return client;
  };

  const inRoom = (server: number, client: Client, room: string) =>
    servers[server]!.io.of('/').adapter.rooms.get(room)?.has(client.socket.id!) ?? false;

  const liveJoin = (client: Client, payload: Record<string, unknown>) =>
    client.socket.timeout(3000).emitWithAck('live:join', payload);

  beforeAll(async () => {
    pinnedIsOpen = Object.getOwnPropertyDescriptor(redisClient, 'isOpen');
    if (pinnedIsOpen) delete (redisClient as { isOpen?: boolean }).isOpen;
    if (!redisClient.isOpen) await redisClient.connect();
    await mongoose.connect(TEST_MONGO_URI!);
    await startServer();
    await startServer();

    const deck = await PresentationService.createPresentation(
      createPresentationSchema.parse({
        title: 'Realtime integration',
        slides: [
          {
            type: 'select_answer',
            question: 'Pick one',
            options: [{ text: 'A', isCorrect: true }, { text: 'B' }],
          },
        ],
      }),
      hostId
    );
    presentationId = String(deck._id);
    await PresentationService.openLobby(presentationId, hostId);
    const join = async (name: string) => {
      const joined = await PresentationService.joinPresentation(presentationId, { name });
      return { participantId: joined.participantId, token: joined.token };
    };
    participants = { alice: await join('Alice'), bob: await join('Bob'), carol: await join('Carol') };
  }, 20_000);

  afterAll(async () => {
    for (const client of clients) client.socket.disconnect();
    for (const server of servers) {
      await server.close();
      await new Promise<void>((resolve) => server.io.close(() => resolve()));
    }
    if (presentationId) {
      await waitFor(
        async () => (await PresentationAnswerModel.countDocuments({ presentationId })) === 3,
        'answer write-behind',
      ).catch(() => {});
      const sessionIds = (await PresentationSessionModel.find({ presentationId }).select('_id').lean()).map((s) =>
        String(s._id),
      );
      await Promise.all([
        PresentationModel.deleteOne({ _id: presentationId }),
        PresentationSessionModel.deleteMany({ presentationId }),
        PresentationParticipantModel.deleteMany({ presentationId }),
        PresentationAnswerModel.deleteMany({ presentationId }),
      ]);
      const keys: string[] = [liveSeqKey(presentationId)];
      for (const pattern of [`presentation:${presentationId}:*`, ...sessionIds.map((sid) => `psess:{${sid}}:*`)]) {
        for await (const batch of redisClient.scanIterator({ MATCH: pattern })) keys.push(...batch);
      }
      await redisClient.del(keys);
      await redisClient.sRem('buffer:active_presentation_distributions', presentationId);
    }
    await mongoose.disconnect();
    await redisClient.close();
    if (pinnedIsOpen) Object.defineProperty(redisClient, 'isOpen', pinnedIsOpen);
  }, 20_000);

  it('delivers each event exactly once per room member, across instances and protocols', async () => {
    const { alice, bob, carol } = participants;

    // Instance 0: legacy host, legacy participant, an intruder. Instance 1: a
    // host authenticated at the handshake and participants on both protocols.
    const hostLegacy = await connect('hostLegacy', 0);
    const aliceLegacy = await connect('aliceLegacy', 0);
    const intruder = await connect('intruder', 0);
    const hostHandshake = await connect('hostHandshake', 1, { token: `Bearer ${hostToken}` });
    const bobLive = await connect('bobLive', 1);
    const carolLegacy = await connect('carolLegacy', 1);

    hostLegacy.socket.emit('quiz:join', { quizId: presentationId, role: 'host', accessToken: hostToken });
    aliceLegacy.socket.emit('quiz:join', {
      quizId: presentationId,
      role: 'participant',
      participantId: alice.participantId,
      participantToken: alice.token,
    });
    carolLegacy.socket.emit('quiz:join', {
      quizId: presentationId,
      role: 'participant',
      participantId: carol.participantId,
      participantToken: carol.token,
    });
    intruder.socket.emit('quiz:join', {
      quizId: presentationId,
      role: 'participant',
      participantId: alice.participantId,
      participantToken: 'x'.repeat(32),
    });
    expect(await liveJoin(hostHandshake, { presentationId, role: 'host' })).toEqual({ ok: true, role: 'host' });
    expect(
      await liveJoin(bobLive, {
        presentationId,
        role: 'participant',
        participantId: bob.participantId,
        participantToken: bob.token,
      })
    ).toEqual({ ok: true, role: 'participant' });
    expect(await liveJoin(intruder, { presentationId, role: 'host' })).toEqual({ ok: false, error: 'UNAUTHENTICATED' });

    await waitFor(
      () =>
        inRoom(0, hostLegacy, `quiz_${presentationId}_host`) &&
        inRoom(0, hostLegacy, `live:${presentationId}:host`) &&
        inRoom(0, aliceLegacy, `quiz_${presentationId}`) &&
        inRoom(0, aliceLegacy, `live:${presentationId}:p:${alice.participantId}`) &&
        inRoom(1, carolLegacy, `quiz_${presentationId}`) &&
        inRoom(1, carolLegacy, `live:${presentationId}`),
      'legacy joins'
    );
    // Lobby/join events published before the sockets joined are not part of this test.
    await Bun.sleep(100);
    baselineSeq = Number((await redisClient.get(liveSeqKey(presentationId))) ?? 0);
    expect(baselineSeq).toBeGreaterThan(0);
    expect(await redisClient.ttl(liveSeqKey(presentationId))).toBeGreaterThan(0);

    // --- Drive a round through the real service --------------------------------
    await PresentationService.advanceSlide(presentationId, hostId);
    await Promise.all(
      [alice, bob, carol].map((p) =>
        PresentationService.submitAnswer(presentationId, {
          participantId: p.participantId,
          participantToken: p.token,
          slideIndex: 0,
          optionIndex: 0,
        })
      )
    );
    // A publisher asking for the wrong audience still cannot reach participants.
    await publishLiveEvent({
      presentationId,
      type: 'answer:received',
      payload: { slideIndex: 0, answeredCount: 3, forged: true },
      audience: 'all',
    });
    await publishLiveEvent({
      presentationId,
      type: 'question:started',
      payload: { probe: 'alice-only' },
      audience: `participant:${alice.participantId}`,
    });
    await PresentationService.revealCurrentSlide(presentationId, hostId);
    await PresentationService.endPresentation(presentationId, hostId);

    const fresh = (events: Envelope[]) => events.filter((e) => e.seq > baselineSeq);
    const ended = (client: Client) => fresh(client.live).some((e) => e.type === 'quiz:ended');
    await waitFor(() => [hostLegacy, hostHandshake, aliceLegacy, bobLive, carolLegacy].every(ended), 'quiz:ended');
    // Give duplicates, if any, time to arrive.
    await Bun.sleep(300);

    const types = (events: Envelope[]) => fresh(events).map((e) => e.type);
    const roundForHost = [
      'question:started',
      'answer:received',
      'answer:received',
      'answer:received',
      'answer:received',
      'question:revealed',
      'session:ended',
      'quiz:ended',
    ];
    // The session engine publishes `session:ended` and then its legacy copy `quiz:ended`.
    const roundForParticipant = ['question:started', 'question:revealed', 'session:ended', 'quiz:ended'];

    expect(types(hostLegacy.live)).toEqual(roundForHost);
    expect(types(hostLegacy.legacy)).toEqual(roundForHost);
    expect(types(hostHandshake.live)).toEqual(roundForHost);
    expect(types(hostHandshake.legacy)).toEqual([]);
    expect(types(aliceLegacy.live)).toEqual([
      'question:started',
      'question:started',
      'question:revealed',
      'session:ended',
      'quiz:ended',
    ]);
    expect(fresh(aliceLegacy.live)[1]!.payload).toEqual({ probe: 'alice-only' });
    expect(types(aliceLegacy.legacy)).toEqual(roundForParticipant);
    expect(types(bobLive.live)).toEqual(roundForParticipant);
    expect(types(bobLive.legacy)).toEqual([]);
    expect(types(carolLegacy.live)).toEqual(roundForParticipant);
    expect(types(carolLegacy.legacy)).toEqual(roundForParticipant);
    expect(intruder.live).toEqual([]);
    expect(intruder.legacy).toEqual([]);

    // answer:received never reaches a participant socket, on either protocol.
    for (const client of [aliceLegacy, bobLive, carolLegacy, intruder]) {
      expect([...client.live, ...client.legacy].some((e) => e.type === 'answer:received')).toBe(false);
    }
    expect(fresh(hostLegacy.live).filter((e) => e.payload.forged)).toMatchObject([{ audience: 'host' }]);

    // Exactly once and in order: per socket, seqs are unique and strictly increasing.
    for (const client of clients) {
      for (const events of [client.live, client.legacy]) {
        const seqs = events.map((e) => e.seq);
        expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
      }
    }
    // Together the sockets saw every seq of the round, with no gaps.
    const seen = new Set(clients.flatMap((c) => fresh(c.live).map((e) => e.seq)));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 9 }, (_, i) => baselineSeq + 1 + i));

    // The legacy copy is the same envelope, so current clients keep reading quizId/type/payload.
    const legacyEnded = fresh(hostLegacy.legacy).at(-1)!;
    expect(legacyEnded).toEqual(fresh(hostLegacy.live).at(-1)!);
    const sessionId = String((await PresentationSessionModel.findOne({ presentationId }).lean())!._id);
    expect(legacyEnded).toMatchObject({ v: 1, quizId: presentationId, presentationId, sessionId, audience: 'all' });
    // Every event the service published carries the session (the forged probe was published without one).
    expect(fresh(hostLegacy.live).filter((e) => !e.payload.forged).every((e) => e.sessionId === sessionId)).toBe(true);
    expect(Array.isArray(legacyEnded.payload.leaderboard)).toBe(true);
  }, 30_000);

  it('stops delivering after quiz:leave / live:leave', async () => {
    const byName = (name: string) => clients.find((c) => c.name === name)!;
    const hostLegacy = byName('hostLegacy');
    const hostHandshake = byName('hostHandshake');
    hostLegacy.socket.emit('quiz:leave', presentationId);
    expect(await hostHandshake.socket.timeout(3000).emitWithAck('live:leave', { presentationId })).toEqual({ ok: true });
    await waitFor(() => !inRoom(0, hostLegacy, `quiz_${presentationId}`), 'quiz:leave');

    const before = [hostLegacy, hostHandshake].map((c) => c.live.length + c.legacy.length);
    const probe = await publishLiveEvent({ presentationId, type: 'quiz:ended', payload: { probe: 'after-leave' } });
    expect(probe?.seq).toBeGreaterThan(baselineSeq);
    const bob = byName('bobLive');
    await waitFor(() => bob.live.some((e) => e.seq === probe!.seq), 'probe after leave');
    await Bun.sleep(100);

    expect([hostLegacy, hostHandshake].map((c) => c.live.length + c.legacy.length)).toEqual(before);
  }, 15_000);
});
