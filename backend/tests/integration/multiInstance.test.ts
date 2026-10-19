import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, settleLiveEngine, startTestServer, type TestServer } from './harness';

/**
 * Two backend instances on one Redis and one Mongo (what a load balancer
 * gives you), once with the Socket.io Redis adapter and once without. Every
 * event must reach every socket exactly once, and the coalesced host update
 * must come out once, whichever instance took the answers.
 */

type Envelope = { type: string; sessionId: string | null; seq: number; payload: Record<string, any> };
type Client = { name: string; instance: 0 | 1; socket: ReturnType<TestServer['connectSocket']>; live: Envelope[]; legacy: Envelope[] };

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 8000) => {
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

for (const adapter of [true, false]) {
  describeIntegration(`two instances, socket redis adapter ${adapter ? 'on' : 'off'}`, () => {
    const servers: TestServer[] = [];
    const clients: Client[] = [];
    let host: TestUser;

    const api = async (instance: 0 | 1, method: string, path: string, options: { user?: TestUser; body?: unknown } = {}) => {
      const res = await servers[instance]!.request(`/api/presentations${path}`, {
        method,
        headers: options.user?.headers ?? {},
        body: options.body,
      });
      return { status: res.status, body: (await res.json()) as { data: any; code?: string } };
    };

    const connect = async (name: string, instance: 0 | 1, user?: TestUser) => {
      const socket = servers[instance]!.connectSocket(user ? { auth: { token: `Bearer ${user.accessToken}` } } : {});
      const client: Client = { name, instance, socket, live: [], legacy: [] };
      socket.on('live:event', (event: Envelope) => client.live.push(event));
      socket.on('quiz:event', (event: Envelope) => client.legacy.push(event));
      await waitFor(() => socket.connected, `${name} connect`);
      clients.push(client);
      return client;
    };

    beforeAll(async () => {
      const key = `openpoll-w2d-${randomUUID()}`;
      for (let i = 0; i < 2; i += 1) {
        servers.push(await startTestServer({ redisAdapter: { enabled: adapter, key } }));
      }
    }, 30_000);

    beforeEach(async () => {
      await resetTestData();
      host = await createVerifiedUser({ name: 'Host' });
    });

    afterAll(async () => {
      for (const client of clients) client.socket.disconnect();
      await resetTestData();
      for (const server of servers) await server.close();
    });

    it('delivers every event once to every socket and coalesces the host update across instances', async () => {
      const created = await api(0, 'POST', '/', { user: host, body: { title: 'Two instances', slides: [SELECT] } });
      expect(created.status).toBe(201);
      const pid = created.body.data._id as string;
      await api(0, 'POST', `/${pid}/host/open-lobby`, { user: host });

      const joined = [];
      for (let i = 0; i < 12; i += 1) joined.push((await api((i % 2) as 0 | 1, 'POST', `/${pid}/join`, { body: { name: `P${i}` } })).body.data);

      const hostA = await connect('hostA', 0, host);
      const hostB = await connect('hostB', 1, host);
      const people = await Promise.all(joined.map((who, i) => connect(`p${i}`, (i % 2) as 0 | 1)));
      const legacy = await connect('legacy', 1);
      for (const client of [hostA, hostB]) {
        expect(await client.socket.timeout(3000).emitWithAck('live:join', { presentationId: pid, role: 'host' })).toEqual({ ok: true, role: 'host' });
      }
      for (const [i, client] of people.entries()) {
        const who = joined[i];
        expect(
          await client.socket
            .timeout(3000)
            .emitWithAck('live:join', { presentationId: pid, role: 'participant', participantId: who.participantId, participantToken: who.token })
        ).toEqual({ ok: true, role: 'participant' });
      }
      legacy.socket.emit('quiz:join', { quizId: pid, role: 'participant', participantId: joined[0].participantId, participantToken: joined[0].token });
      await waitFor(async () => (await servers[1]!.io.in(`quiz_${pid}`).fetchSockets()).length >= 1, 'legacy room');

      if (adapter) {
        // The adapter links the servers: instance 0 sees instance 1's sockets in the room.
        const everyone = await servers[0]!.io.in(`live:${pid}`).fetchSockets();
        expect(everyone).toHaveLength(15); // 2 hosts + 12 participants + the legacy one
        expect(everyone.filter((s) => s.constructor.name === 'RemoteSocket')).toHaveLength(8); // instance 1's
      } else {
        expect(await servers[0]!.io.in(`live:${pid}`).fetchSockets()).toHaveLength(7); // only its own
      }
      const baseline = Math.max(0, ...clients.flatMap((c) => c.live.map((e) => e.seq)));

      // Advance on one instance, answer on both.
      await api(0, 'POST', `/${pid}/host/advance`, { user: host });
      const answers = await Promise.all(
        joined.map((who, i) =>
          api((i % 2) as 0 | 1, 'POST', `/${pid}/answer`, {
            body: { participantId: who.participantId, participantToken: who.token, slideIndex: 0, optionIndex: i % 2 },
          })
        )
      );
      expect(answers.every((a) => a.status === 200)).toBe(true);
      await settleLiveEngine();
      await api(1, 'POST', `/${pid}/host/reveal`, { user: host });
      await api(1, 'POST', `/${pid}/host/end`, { user: host });

      const ended = (c: Client) => c.live.some((e) => e.type === 'quiz:ended');
      await waitFor(() => [hostA, hostB, legacy, ...people].every(ended), 'quiz:ended on every socket');
      await Bun.sleep(300); // time for duplicates to show up

      const fresh = (c: Client) => c.live.filter((e) => e.seq > baseline);
      // Exactly once: no socket sees a seq twice, and seqs arrive in order.
      for (const client of clients) {
        for (const events of [client.live, client.legacy]) {
          const seqs = events.map((e) => e.seq);
          expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
        }
      }
      // Both hosts, on different instances, saw the very same round.
      const roundOf = (c: Client) => fresh(c).map((e) => `${e.seq}:${e.type}`);
      expect(roundOf(hostA)).toEqual(roundOf(hostB));
      const hostTypes = fresh(hostA).map((e) => e.type);
      expect(hostTypes.filter((t) => t === 'question:started')).toHaveLength(1);
      expect(hostTypes.filter((t) => t === 'question:revealed')).toHaveLength(1);
      expect(hostTypes.filter((t) => t === 'session:ended')).toHaveLength(1);
      // 12 answers over 2 instances: coalesced into a handful of updates, each seq once, last one complete.
      const updates = fresh(hostA).filter((e) => e.type === 'answer:received');
      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates.length).toBeLessThanOrEqual(3);
      expect(updates.at(-1)!.payload).toMatchObject({ answeredCount: 12, participantCount: 12 });
      // Participants get the round without host-only data, once each.
      for (const client of [...people, legacy]) {
        expect(fresh(client).map((e) => e.type)).toEqual(['question:started', 'question:revealed', 'session:ended', 'quiz:ended']);
      }
      expect(legacy.legacy.filter((e) => e.seq > baseline).map((e) => e.type)).toEqual(['question:started', 'question:revealed', 'session:ended', 'quiz:ended']);
    }, 60_000);
  });
}
