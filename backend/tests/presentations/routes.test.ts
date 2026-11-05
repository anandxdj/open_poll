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
  // The session engine (W1-A1) added live-state, start/goto/close/reopen and the
  // session list, and put workspaceContext() after authenticate() on every
  // creator and host route (+1 handler each; goto/advance also validate).
  // Duplicate adds a per-user rate limit between authenticate() and workspaceContext().
  it('matches the route list and middleware counts', () => {
    expect(listRoutes((presentationsRouter as any).stack)).toEqual([
      'GET /code/:code (3)',
      'POST /:id/join (3)',
      'POST /:id/answer (3)',
      'GET /:id/me (2)',
      'GET /:id/live-state (2)',
      'POST / (4)',
      'GET / (3)',
      'GET /:id (3)',
      'PATCH /:id (4)',
      'DELETE /:id (3)',
      'POST /:id/duplicate (4)',
      'GET /:id/host/state (3)',
      'POST /:id/host/open-lobby (3)',
      'POST /:id/host/start (3)',
      'POST /:id/host/goto (4)',
      'POST /:id/host/advance (4)',
      'POST /:id/host/close (3)',
      'POST /:id/host/reopen (3)',
      'POST /:id/host/reveal (3)',
      'POST /:id/host/end (3)',
      // W2-A presenter tools: timer (validates), skip, kick, the phone-remote pairing (rate limited when written).
      'POST /:id/host/timer (4)',
      'POST /:id/host/skip (3)',
      'POST /:id/host/participants/:participantId/kick (3)',
      'GET /:id/host/remote-token (3)',
      'POST /:id/host/remote-token (4)',
      'DELETE /:id/host/remote-token (4)',
      'GET /:id/sessions (3)',
    ]);
  });
});
