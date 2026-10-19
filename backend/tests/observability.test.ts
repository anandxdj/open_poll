import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { httpMetrics, joinRoute } from '../src/common/observability/httpMetrics.middleware';
import { redisCommandDuration, renderMetrics } from '../src/common/observability/metrics';
import { timeRedis } from '../src/common/observability/redisTiming';
import { hasValidMetricsToken } from '../src/modules/metrics/metrics.route';

const TOKEN = 'metrics-token-0123456789abcdef';
const withAuth = (authorization?: string) => ({ headers: authorization === undefined ? {} : { authorization } });

describe('metrics bearer token', () => {
  it('accepts exactly the configured token as a Bearer credential', () => {
    expect(hasValidMetricsToken(withAuth(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
    expect(hasValidMetricsToken(withAuth(`Bearer   ${TOKEN}  `), TOKEN)).toBe(true);
  });

  it('refuses a missing, malformed, other-scheme, shorter, longer or different token', () => {
    for (const header of [undefined, '', 'Bearer', 'Bearer ', TOKEN, `Basic ${TOKEN}`, `bearer ${TOKEN}`, `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, `Bearer ${'x'.repeat(TOKEN.length)}`]) {
      expect(hasValidMetricsToken(withAuth(header), TOKEN)).toBe(false);
    }
  });
});

describe('route labels', () => {
  it('joins the mount prefix and the route pattern without raw ids', () => {
    expect(joinRoute('/api/presentations', '/:id/answer')).toBe('/api/presentations/:id/answer');
    expect(joinRoute('/api/presentations', '/')).toBe('/api/presentations');
    expect(joinRoute('', '/health')).toBe('/health');
    expect(joinRoute(undefined, '/')).toBe('/');
    expect(joinRoute('/x', /regex/)).toBeNull();
  });

  it('labels a request by the route the router matched, even after the error handler reset the prefix', async () => {
    const req = Object.assign(new EventEmitter(), { method: 'POST', originalUrl: '/api/presentations/5f8d0d55b54764421b7156c3/answer', baseUrl: '' }) as any;
    const res = Object.assign(new EventEmitter(), { statusCode: 409 }) as any;
    httpMetrics(req, res, () => {});
    // The router mounts the route while baseUrl is right, then the error handler runs with it reset.
    req.baseUrl = '/api/presentations';
    req.route = { path: '/:id/answer' };
    req.baseUrl = '';
    res.emit('finish');

    const text = (await renderMetrics()).body;
    expect(text).toContain('route="/api/presentations/:id/answer",status_code="409"');
    expect(text).not.toContain('5f8d0d55b54764421b7156c3');
  });

  it('files requests no route matched under one label, and does not time /metrics', async () => {
    const unmatchedReq = Object.assign(new EventEmitter(), { method: 'GET', originalUrl: '/wp-login.php', baseUrl: '' }) as any;
    const unmatchedRes = Object.assign(new EventEmitter(), { statusCode: 404 }) as any;
    httpMetrics(unmatchedReq, unmatchedRes, () => {});
    unmatchedRes.emit('finish');
    expect((await renderMetrics()).body).toContain('route="unmatched",status_code="404"');

    const scrapeReq = Object.assign(new EventEmitter(), { method: 'GET', originalUrl: '/metrics', baseUrl: '' }) as any;
    const scrapeRes = Object.assign(new EventEmitter(), { statusCode: 200 }) as any;
    httpMetrics(scrapeReq, scrapeRes, () => {});
    scrapeRes.emit('finish');
    expect((await renderMetrics()).body).not.toContain('route="/metrics"');
  });
});

describe('timeRedis', () => {
  const count = async (op: string, outcome: string) =>
    (await redisCommandDuration.get()).values.find(
      (v) => v.labels.op === op && v.labels.outcome === outcome && (v as { metricName?: string }).metricName?.endsWith('_count')
    )?.value ?? 0;

  it('records ok and error outcomes by operation and passes results and errors through', async () => {
    const okBefore = await count('unit_op', 'ok');
    const errBefore = await count('unit_op', 'error');
    expect(await timeRedis('unit_op', async () => 42)).toBe(42);
    await expect(timeRedis('unit_op', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await count('unit_op', 'ok')).toBe(okBefore + 1);
    expect(await count('unit_op', 'error')).toBe(errBefore + 1);
  });
});
