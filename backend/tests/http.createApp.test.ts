import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, Router } from 'express';
import { createApp } from '../src/http/createApp';
import { billingWebhookRouter } from '../src/modules/billing/billing.route';
import libraryRouter from '../src/modules/library/library.route';
import scimRouter from '../src/modules/scim/scim.route';
import { samlAcsRouter } from '../src/modules/sso/sso.route';

/**
 * Behaviour of the pre-wired special mounts. Probe handlers are attached to the
 * empty stub routers for the duration of this file, then removed so the route
 * snapshot never sees them. Needs no Mongo or Redis.
 */
const echo = (req: Request, res: Response) => {
  res.json({
    isBuffer: Buffer.isBuffer(req.body),
    raw: Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null,
    body: Buffer.isBuffer(req.body) ? null : req.body,
    params: req.params,
  });
};

const probes: Array<[Router, string]> = [
  [billingWebhookRouter, '/'],
  [samlAcsRouter, '/'],
  [scimRouter, '/Users'],
  [libraryRouter, '/__probe'],
];

let server: Server;
let baseUrl = '';
const stackSizes = new Map<Router, number>();
// The error handler logs the rejected-origin and oversized-body cases on purpose.
const consoleError = spyOn(console, 'error').mockImplementation(() => {});

beforeAll(async () => {
  for (const [router, path] of probes) {
    stackSizes.set(router, router.stack.length);
    router.post(path, echo);
  }
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [router, size] of stackSizes) router.stack.splice(size);
  consoleError.mockRestore();
});

const post = (path: string, body: string, headers: Record<string, string>) =>
  fetch(`${baseUrl}${path}`, { method: 'POST', body, headers });

interface Echo {
  isBuffer: boolean;
  raw: string | null;
  body: unknown;
  params: Record<string, string>;
}
const readEcho = async (res: globalThis.Response) => (await res.json()) as Echo;

const jsonBodyOfSize = (bytes: number) => JSON.stringify({ title: 'x'.repeat(bytes) });

describe('createApp special mounts', () => {
  it('hands the Stripe webhook the exact raw bytes', async () => {
    const payload = '{"id":"evt_1","data":{"a.b":1,"$set":2}}';
    const res = await post('/api/billing/webhook', payload, { 'content-type': 'application/json; charset=utf-8' });
    expect(res.status).toBe(200);
    const body = await readEcho(res);
    expect(body.isBuffer).toBe(true);
    expect(body.raw).toBe(payload);
  });

  it('accepts a cross-origin SAML form post and parses it', async () => {
    const res = await post('/api/sso/saml/conn_123/acs', 'SAMLResponse=PHNhbWw%2B&RelayState=%2Fdashboard', {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://idp.example.com',
    });
    expect(res.status).toBe(200);
    const body = await readEcho(res);
    expect(body.params).toEqual({ connectionId: 'conn_123' });
    expect(body.body).toEqual({ SAMLResponse: 'PHNhbWw+', RelayState: '/dashboard' });
  });

  it('parses application/scim+json and keeps dotted URN keys', async () => {
    const user = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'ada@example.com',
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'R&D' },
    };
    const res = await post('/scim/v2/Users', JSON.stringify(user), { 'content-type': 'application/scim+json' });
    expect(res.status).toBe(200);
    expect((await readEcho(res)).body).toEqual(user);
  });

  it('still sanitizes bodies on the regular API', async () => {
    const res = await post('/api/library/__probe', JSON.stringify({ $where: '1', 'a.b': 2, ok: 3 }), {
      'content-type': 'application/json',
    });
    expect(res.status).toBe(200);
    expect((await readEcho(res)).body).toEqual({ ok: 3 });
  });

  it('accepts deck bodies up to 1mb and keeps the 100kb cap elsewhere', async () => {
    const deck = jsonBodyOfSize(300_000);
    // Parsed, then rejected by authenticate(): the body limit did not fire.
    expect((await post('/api/presentations', deck, { 'content-type': 'application/json' })).status).toBe(401);
    expect((await post('/api/quizzes', deck, { 'content-type': 'application/json' })).status).toBe(401);

    const polls = await post('/api/polls', deck, { 'content-type': 'application/json' });
    expect(polls.status).not.toBe(401);
    expect(polls.status).toBeGreaterThanOrEqual(400);

    const oversized = await post('/api/presentations', jsonBodyOfSize(1_100_000), {
      'content-type': 'application/json',
    });
    expect(oversized.status).not.toBe(401);
    expect(oversized.status).toBeGreaterThanOrEqual(400);
  });

  it('keeps CORS on the browser API', async () => {
    const allowed = await fetch(`${baseUrl}/health`, { headers: { origin: 'http://localhost:3000' } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');

    const foreign = await fetch(`${baseUrl}/health`, { headers: { origin: 'https://evil.example.com' } });
    expect(foreign.status).not.toBe(200);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('leaves unknown paths to the default 404', async () => {
    expect((await fetch(`${baseUrl}/api/library/missing`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/scim/v2/Unknown`)).status).toBe(404);
  });
});
