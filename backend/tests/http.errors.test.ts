import { describe, expect, it } from 'bun:test';
import express from 'express';
import { errorHandler } from '../src/common/middlewares/errorHandler';
import { corsMiddleware } from '../src/common/middlewares/cors';

// Client mistakes must not surface as 500s (and must not be logged as server faults).
describe('error handler maps client errors', () => {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: '1kb' }));
  app.post('/echo', (req, res) => {
    res.json(req.body);
  });
  app.use(errorHandler);

  const call = async (init: RequestInit) => {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      return await fetch(`http://127.0.0.1:${port}/echo`, { method: 'POST', ...init });
    } finally {
      server.close();
    }
  };

  it('oversized JSON body is 413', async () => {
    const res = await call({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(4096) }) });
    expect(res.status).toBe(413);
  });

  it('malformed JSON body is 400', async () => {
    const res = await call({ headers: { 'content-type': 'application/json' }, body: '{"x":' });
    expect(res.status).toBe(400);
  });

  it('disallowed CORS origin is 403', async () => {
    const res = await call({ headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    expect(res.status).toBe(403);
  });
});
