/**
 * Integration fixtures. Users are written straight to Mongo (signing up needs
 * the email round trip); polls and presentations go through the public API
 * so they get exactly what a real client would.
 */
import { randomUUID } from 'node:crypto';
import { generateAccessToken } from '../../src/common/utils/jwt.utils';
import { UserModel } from '../../src/modules/auth/auth.model';
import type { TestServer } from './harness';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  password: string;
  accessToken: string;
  /** `{ authorization: 'Bearer …' }`, ready to spread into request headers. */
  headers: { authorization: string };
}

/** A verified email/password user and an access token signed like a real login. */
export async function createVerifiedUser(
  overrides: Partial<{ email: string; name: string; password: string; role: 'user' | 'admin' }> = {},
): Promise<TestUser> {
  const email = overrides.email ?? `user-${randomUUID()}@example.com`;
  const name = overrides.name ?? 'Test User';
  const password = overrides.password ?? 'Correct-Horse-9';
  const role = overrides.role ?? 'user';
  const user = await UserModel.create({ email, name, password, role, isVerified: true });
  const accessToken = generateAccessToken({ id: user._id, email: user.email, name: user.name, role: user.role });
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    password,
    accessToken,
    headers: { authorization: `Bearer ${accessToken}` },
  };
}

async function createVia(server: TestServer, path: string, owner: TestUser, body: Record<string, unknown>) {
  const res = await server.request(path, { method: 'POST', headers: owner.headers, body });
  const json = (await res.json()) as { success: boolean; message: string; data: any };
  if (res.status !== 201) throw new Error(`POST ${path} → ${res.status}: ${json.message}`);
  return json.data;
}

/** A published single-question poll via POST /api/polls; `overrides` replace top-level fields. */
export async function createPoll(server: TestServer, owner: TestUser, overrides: Record<string, unknown> = {}) {
  return createVia(server, '/api/polls', owner, {
    title: 'Integration poll',
    pollType: 'POLL',
    isPublished: true,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    questions: [{ text: 'Best runtime?', options: ['Bun', 'Node'], type: 'single' }],
    ...overrides,
  });
}

/** A one-slide select_answer deck via POST /api/presentations; `overrides` replace top-level fields. */
export async function createPresentation(server: TestServer, owner: TestUser, overrides: Record<string, unknown> = {}) {
  return createVia(server, '/api/presentations', owner, {
    title: 'Integration deck',
    slides: [
      {
        type: 'select_answer',
        question: 'Pick one',
        options: [
          { text: 'A', isCorrect: true },
          { text: 'B', isCorrect: false },
        ],
      },
    ],
    ...overrides,
  });
}
