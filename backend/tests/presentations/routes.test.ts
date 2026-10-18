import { describe, expect, it } from 'bun:test';
import presentationsRouter from '../../src/modules/presentations/presentations.route';

/**
 * Route-table snapshot for `/api/presentations` (also mounted at `/api/quizzes`).
 * Walks nested routers so splitting the router into sub-routers must keep the
 * same method + path list, in the same match order, with the same number of
 * handlers (middleware chain length) per route.
 */
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: unknown[] }; handle?: any };

const listRoutes = (stack: Layer[]): string[] =>
  stack.flatMap((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route!.methods[m])
        .map((m) => m.toUpperCase())
        .join(',');
      return [`${methods} ${layer.route.path} (${layer.route.stack.length})`];
    }
    if (layer.handle?.stack) return listRoutes(layer.handle.stack);
    return [];
  });

describe('presentations route table', () => {
  it('matches the pre-split route list and middleware counts', () => {
    expect(listRoutes((presentationsRouter as any).stack)).toEqual([
      'GET /code/:code (3)',
      'POST /:id/join (3)',
      'POST /:id/answer (3)',
      'GET /:id/me (2)',
      'POST / (3)',
      'GET / (2)',
      'GET /:id (2)',
      'PATCH /:id (3)',
      'DELETE /:id (2)',
      'GET /:id/host/state (2)',
      'POST /:id/host/open-lobby (2)',
      'POST /:id/host/advance (2)',
      'POST /:id/host/reveal (2)',
      'POST /:id/host/end (2)',
    ]);
  });
});
