import { afterAll, beforeAll, expect, it } from 'bun:test';
import { createPoll, createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

describeIntegration('integration harness', () => {
  let server: TestServer;
  let owner: TestUser;

  beforeAll(async () => {
    server = await startTestServer();
    await resetTestData();
    owner = await createVerifiedUser();
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  it('reports ready with live Mongo and Redis', async () => {
    const res = await server.request('/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'READY', services: { mongodb: true, redis: true } });
  });

  it('authenticates the fixture user', async () => {
    const res = await server.request('/api/auth/me', { headers: owner.headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string } };
    expect(body.data.email).toBe(owner.email);
  });

  it('creates and reads back a poll', async () => {
    const poll = await createPoll(server, owner, { title: 'Harness poll' });
    const res = await server.request(`/api/polls/${poll._id}`, { headers: owner.headers });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { title: string } }).data.title).toBe('Harness poll');
  });

  it('creates and reads back a presentation', async () => {
    const deck = await createPresentation(server, owner, { title: 'Harness deck' });
    const res = await server.request(`/api/presentations/${deck._id}`, { headers: owner.headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { title: string; slides: unknown[] } };
    expect(body.data.title).toBe('Harness deck');
    expect(body.data.slides).toHaveLength(1);
  });

  it('serves the realtime socket on the same port', async () => {
    const socket = server.connectSocket();
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    expect(socket.connected).toBe(true);
  });

  it('answers stub module mounts with 404 until their package lands', async () => {
    expect((await server.request('/api/templates', { headers: owner.headers })).status).toBe(404);
    expect((await server.request('/scim/v2/Users')).status).toBe(404);
  });
});
