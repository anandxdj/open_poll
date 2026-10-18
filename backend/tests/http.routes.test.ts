import { describe, expect, it } from 'bun:test';
import { listRoutes, readRouteSnapshot, writeRouteSnapshot } from './helpers/routes';
import { createApp } from '../src/http/createApp';

/**
 * Route snapshot: every middleware, mount and route the app registers, in
 * order. Refresh after an intended change with
 * `UPDATE_ROUTE_SNAPSHOT=1 bun test tests/http.routes.test.ts` and review the
 * diff of tests/http.routes.snapshot.txt.
 */
const routes = listRoutes(createApp());

describe('HTTP route table', () => {
  it('matches the committed snapshot', () => {
    if (process.env.UPDATE_ROUTE_SNAPSHOT === '1') writeRouteSnapshot(routes);
    expect(routes).toEqual(readRouteSnapshot());
  });

  const indexOf = (line: string) => {
    const index = routes.indexOf(line);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('runs the Stripe webhook raw parser before CORS and the global JSON parser', () => {
    const raw = indexOf('USE /api/billing/webhook rawParser');
    expect(raw).toBeLessThan(indexOf('USE / corsMiddleware'));
    expect(raw).toBeLessThan(indexOf('USE / jsonParser'));
  });

  it('parses SAML ACS form posts before CORS', () => {
    expect(indexOf('USE /api/sso/saml/:connectionId/acs urlencodedParser')).toBeLessThan(
      indexOf('USE / corsMiddleware'),
    );
  });

  it('serves SCIM before mongoSanitize can strip its dotted URN keys', () => {
    expect(indexOf('USE /scim/v2 jsonParser')).toBeLessThan(indexOf('ROUTER /scim/v2'));
    expect(indexOf('ROUTER /scim/v2')).toBeLessThan(indexOf('USE / mongoSanitize'));
  });

  it('gives decks the 1mb JSON parser ahead of the 100kb default', () => {
    expect(indexOf('USE [/api/presentations,/api/quizzes] jsonParser')).toBeLessThan(indexOf('USE / jsonParser'));
  });

  it('mounts nested module routers ahead of the router that owns the parent path', () => {
    const presentations = indexOf('ROUTER /api/presentations');
    expect(indexOf('ROUTER /api/presentations/:presentationId/qna')).toBeLessThan(presentations);
    expect(indexOf('ROUTER /api/presentations/:presentationId/host/qna')).toBeLessThan(presentations);
    expect(indexOf('ROUTER /api/workspaces/:workspaceId/domains')).toBeLessThan(indexOf('ROUTER /api/workspaces'));
  });

  it('keeps the error handler last', () => {
    expect(routes.at(-1)).toBe('USE / errorHandler');
  });
});
