import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import aiRouter from '../src/modules/ai/ai.route';
import { errorHandler } from '../src/common/middlewares/errorHandler';

// The AI routes spend LLM quota and generate-and-save writes a poll, so none of
// them may be reachable anonymously (5e63f87 had silently dropped the guard).
describe('AI routes require authentication', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/ai', aiRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/ai`;
  });

  afterAll(() => {
    server.close();
  });

  for (const path of ['/generate', '/generate-and-save', '/generate-quiz']) {
    it(`POST ${path} without a token is 401`, async () => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'anything', creatorId: 'someone-else' }),
      });
      expect(res.status).toBe(401);
    });
  }
});
