import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { listRoutes, readRouteSnapshot, writeRouteSnapshot } from './helpers/routes';
import { redisClient } from '../src/common/config/redis';

/**
 * Route snapshot: every middleware, mount and route the app registers, in
 * order. Refresh after an intended change with
 * `UPDATE_ROUTE_SNAPSHOT=1 bun test tests/http.routes.test.ts`.
 *
 * `app.ts` builds the app and boots at import time, so the boot steps are
 * stubbed and the app is captured from its first `app.use` call.
 */
let app: { router: { stack: unknown[] } } | undefined;
const restores: Array<() => void> = [];

beforeAll(async () => {
  const originalUse = express.application.use;
  express.application.use = function captureApp(this: any, ...args: any[]) {
    app ??= this;
    return (originalUse as any).apply(this, args);
  } as typeof originalUse;
  restores.push(() => {
    express.application.use = originalUse;
  });

  let listening!: () => void;
  const booted = new Promise<void>((resolve) => {
    listening = resolve;
  });
  const listenSpy = spyOn(http.Server.prototype, 'listen').mockImplementation(function (this: http.Server) {
    listening();
    return this;
  } as any);
  const connectSpy = spyOn(mongoose, 'connect').mockResolvedValue({ connection: { host: 'stub' } } as any);
  const redisSpy = spyOn(redisClient, 'connect').mockResolvedValue(redisClient as any);
  restores.push(() => listenSpy.mockRestore(), () => connectSpy.mockRestore(), () => redisSpy.mockRestore());

  mock.module('../src/common/realtime/socket', () => ({ setupSocketAndPubSub: async () => {} }));
  mock.module('../src/modules/responses/analytics.worker', () => ({ startAnalyticsWorker: () => {} }));
  mock.module('../src/modules/presentations/liveDistribution.worker', () => ({
    startLiveDistributionWorker: () => {},
  }));

  await import('../src/app');
  await booted;
});

afterAll(() => {
  for (const restore of restores.reverse()) restore();
});

describe('HTTP route table', () => {
  it('matches the committed snapshot', () => {
    expect(app).toBeDefined();
    const routes = listRoutes(app!);
    if (process.env.UPDATE_ROUTE_SNAPSHOT === '1') writeRouteSnapshot(routes);
    expect(routes).toEqual(readRouteSnapshot());
  });
});
