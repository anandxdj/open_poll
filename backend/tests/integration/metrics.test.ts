import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { env } from '../../src/common/config/env';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, settleLiveEngine, startTestServer, type TestServer } from './harness';

/**
 * GET /metrics: never open (404 without METRICS_TOKEN, 401 without the bearer),
 * and what it exposes: request latency by route PATTERN, socket connections,
 * accepted/rejected answers, Redis timings, process defaults.
 */

const TOKEN = 'metrics-token-0123456789abcdef';
const SELECT = {
  type: 'select_answer',
  question: 'Capital of France?',
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 60,
};

describeIntegration('metrics endpoint', () => {
  let server: TestServer;
  let host: TestUser;
  const original = { token: env.metricsToken, flag: env.capabilities.metrics };

  const enable = () => {
    (env as { metricsToken: string | null }).metricsToken = TOKEN;
    env.capabilities.metrics = true;
  };
  const disable = () => {
    (env as { metricsToken: string | null }).metricsToken = null;
    env.capabilities.metrics = false;
  };
  const scrape = (headers: Record<string, string> = {}) => server.request('/metrics', { headers });

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    host = await createVerifiedUser({ name: 'Host' });
    disable();
  });

  afterAll(async () => {
    (env as { metricsToken: string | null }).metricsToken = original.token;
    env.capabilities.metrics = original.flag;
    await resetTestData();
    await server?.close();
  });

  it('does not exist without a token: 404 for everyone, capability off', async () => {
    expect((await scrape()).status).toBe(404);
    expect((await scrape({ authorization: `Bearer ${TOKEN}` })).status).toBe(404);
    const capabilities = (await (await server.request('/api/capabilities')).json()) as { data: { metrics: boolean } };
    expect(capabilities.data.metrics).toBe(false);
  });

  it('wants the bearer token, compared exactly', async () => {
    enable();
    const none = await scrape();
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toStartWith('Bearer');
    expect((await scrape({ authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await scrape({ authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
    expect((await scrape({ authorization: `Bearer ${TOKEN.slice(0, -1)}` })).status).toBe(401);
    expect((await scrape({ authorization: TOKEN })).status).toBe(401);
    expect((await scrape({ authorization: `Basic ${TOKEN}` })).status).toBe(401);
    const ok = await scrape({ authorization: `Bearer ${TOKEN}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toStartWith('text/plain');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const capabilities = (await (await server.request('/api/capabilities')).json()) as { data: { metrics: boolean } };
    expect(capabilities.data.metrics).toBe(true);
  });

  it('exposes route-pattern latency, sockets, answers and Redis timings', async () => {
    enable();
    const created = await server.request('/api/presentations', {
      method: 'POST',
      headers: host.headers,
      body: { title: 'Metrics deck', slides: [SELECT] },
    });
    const pid = ((await created.json()) as { data: { _id: string } }).data._id;
    const hostCall = (command: string) => server.request(`/api/presentations/${pid}/host/${command}`, { method: 'POST', headers: host.headers });
    await hostCall('open-lobby');
    const join = async (name: string) =>
      ((await (await server.request(`/api/presentations/${pid}/join`, { method: 'POST', body: { name } })).json()) as { data: any }).data;
    const ada = await join('Ada');
    await hostCall('advance');
    const answerBody = { participantId: ada.participantId, participantToken: ada.token, slideIndex: 0, optionIndex: 0 };
    await server.request(`/api/presentations/${pid}/answer`, { method: 'POST', body: answerBody });
    await server.request(`/api/presentations/${pid}/answer`, { method: 'POST', body: answerBody }); // 409
    await server.request('/nothing/here/5f8d0d55b54764421b7156c3'); // matches no route
    const sockets = [server.connectSocket(), server.connectSocket()];
    await Bun.sleep(150);
    await settleLiveEngine();

    const text = await (await scrape({ authorization: `Bearer ${TOKEN}` })).text();
    // Latency by route pattern (never a raw id), with the status code.
    expect(text).toMatch(/openpoll_http_request_duration_seconds_bucket\{[^}]*route="\/api\/presentations\/:id\/answer"[^}]*status_code="200"/);
    expect(text).toMatch(/openpoll_http_request_duration_seconds_count\{[^}]*route="\/api\/presentations\/:id\/answer"[^}]*status_code="409"/);
    expect(text).toMatch(/route="\/api\/presentations\/:id\/host\/open-lobby"/);
    expect(text).toMatch(/route="unmatched"/);
    expect(text).not.toContain(pid);
    expect(text).not.toContain('5f8d0d55b54764421b7156c3');
    expect(text).not.toContain('route="/metrics"');
    // Answers and sockets.
    expect(text).toMatch(/openpoll_answers_accepted_total\{[^}]*via="rest"[^}]*replay="false"[^}]*\} [1-9]/);
    expect(text).toMatch(/openpoll_answers_rejected_total\{[^}]*via="rest"[^}]*reason="already_answered"[^}]*\} [1-9]/);
    expect(text).toMatch(/openpoll_answer_duration_seconds_count\{[^}]*via="rest"[^}]*\} [1-9]/);
    const connections = Number(/^openpoll_socket_connections\{[^}]*\} (\d+)/m.exec(text)?.[1]);
    expect(connections).toBeGreaterThanOrEqual(sockets.length);
    // Redis timings of the hot path and the process defaults.
    expect(text).toMatch(/openpoll_redis_command_duration_seconds_count\{[^}]*op="answer_script"[^}]*outcome="ok"[^}]*\} [1-9]/);
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('app="openpoll-backend"');
  });

  it('is rate limited, so a leaked URL cannot be used to guess the token', async () => {
    enable();
    const statuses: number[] = [];
    for (let i = 0; i < 130; i += 1) statuses.push((await scrape({ authorization: 'Bearer nope' })).status);
    expect(statuses.slice(0, 120).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(120).every((s) => s === 429)).toBe(true);
    // The window is per IP; clear it for the other tests of this run.
    const { redisClient } = await import('../../src/common/config/redis');
    for await (const batch of redisClient.scanIterator({ MATCH: 'rl:metrics:*' })) if (batch.length) await redisClient.del(batch);
  });
});
