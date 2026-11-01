import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import mongoose from 'mongoose';
import { env } from '../../src/common/config/env';
import { generateAccessToken } from '../../src/common/utils/jwt.utils';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { UserModel } from '../../src/modules/auth/auth.model';
import { SsoConnectionModel } from '../../src/modules/sso/ssoConnection.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** The signed-in user's profile and password: PATCH /api/me, POST /api/me/password, hasPassword on GET /api/auth/me. */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: any; data: T };

const NEW_PASSWORD = 'Brand-New-Pass-7';

/** The `refreshToken=<value>` pair of a response's Set-Cookie, or null. */
const refreshCookie = (res: Response) => {
  const cookie = res.headers.getSetCookie().find((value) => value.startsWith('refreshToken='));
  return cookie ? cookie.split(';')[0]! : null;
};

/** Lets fire-and-forget audit inserts and background mail settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describeIntegration('account profile and password over HTTP', () => {
  let server: TestServer;
  let alice: TestUser;

  const api = async <T = any>(method: string, path: string, user: TestUser | null = alice, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await server.request(path, { method, headers: { ...(user ? user.headers : {}), ...headers }, body });
    return { status: res.status, body: (await res.json()) as Body<T>, res };
  };

  const login = (email: string, password: string) => api('POST', '/api/auth/login', null, { email, password });
  /** What the frontend does with the refresh cookie (the route takes only our own origins). */
  const refresh = (cookie: string) => api('POST', '/api/auth/refresh-token', null, {}, { cookie, origin: env.allowedOrigins[0]! });

  /** A Google-only account (no password) and a token for it. */
  const googleUser = async (email = `g-${new mongoose.Types.ObjectId()}@example.com`): Promise<TestUser> => {
    const user = await UserModel.create({
      email,
      name: 'Gina Google',
      isVerified: true,
      identities: [{ provider: 'google', subject: `google-${email}` }],
    });
    const accessToken = generateAccessToken({ id: user._id, email: user.email, name: user.name, role: 'user' });
    return { id: String(user._id), email: user.email, name: user.name, password: '', accessToken, headers: { authorization: `Bearer ${accessToken}` } };
  };

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice Example' });
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('needs a signed-in user', async () => {
    expect((await api('PATCH', '/api/me', null, { name: 'X' })).status).toBe(401);
    expect((await api('POST', '/api/me/password', null, { currentPassword: 'a', newPassword: NEW_PASSWORD })).status).toBe(401);
  });

  describe('GET /api/auth/me', () => {
    it('says whether a password exists and never sends the hash', async () => {
      const me = (await api('GET', '/api/auth/me')).body.data;
      expect(me).toMatchObject({ email: alice.email, name: 'Alice Example', hasPassword: true });
      expect(me).not.toHaveProperty('password');
      expect(me).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(me)).not.toContain('$2');

      const gina = await googleUser();
      const ginaMe = (await api('GET', '/api/auth/me', gina)).body.data;
      expect(ginaMe).toMatchObject({ email: gina.email, hasPassword: false });
      expect(ginaMe).not.toHaveProperty('password');
    });

    it('is the same shape the login response carries', async () => {
      const { body } = await login(alice.email, alice.password);
      expect(body.data.user).toMatchObject({ email: alice.email, hasPassword: true });
      expect(body.data.user).not.toHaveProperty('password');
    });
  });

  describe('PATCH /api/me', () => {
    it('trims and saves the name, returns the GET /api/auth/me shape and audits it', async () => {
      const { status, body } = await api('PATCH', '/api/me', alice, { name: '  Alice Renamed  ' });
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ _id: alice.id, email: alice.email, name: 'Alice Renamed', hasPassword: true });
      expect(body.data).not.toHaveProperty('password');

      const me = (await api('GET', '/api/auth/me')).body.data;
      expect(Object.keys(body.data).sort()).toEqual(Object.keys(me).sort());
      expect(me.name).toBe('Alice Renamed');

      await settle();
      const events = await AuditEventModel.find({ action: 'account.name_update' }).lean();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorType: 'user', targetType: 'user', targetId: alice.id, workspaceId: null });
      expect(String(events[0]!.actorId)).toBe(alice.id);
      // Names stay out of the audit trail (it outlives the account's purge).
      expect(JSON.stringify(events[0]!.meta ?? {})).not.toContain('Alice');
    });

    it('accepts 1 to 80 characters and nothing else', async () => {
      for (const name of ['', '   ', 'x'.repeat(81)]) {
        const { status } = await api('PATCH', '/api/me', alice, { name });
        expect(status, JSON.stringify(name)).toBe(400);
      }
      expect((await api('PATCH', '/api/me', alice, {})).status).toBe(400);
      expect((await api('PATCH', '/api/me', alice, { name: 42 })).status).toBe(400);
      expect((await api('PATCH', '/api/me', alice, { name: 'A' })).body.data.name).toBe('A');
      expect((await api('PATCH', '/api/me', alice, { name: 'y'.repeat(80) })).body.data.name).toBe('y'.repeat(80));
    });

    it('changes only the name: email and role in the body are ignored', async () => {
      const { status } = await api('PATCH', '/api/me', alice, { name: 'Alice', email: 'evil@example.com', role: 'admin' });
      expect(status).toBe(200);
      const stored = await UserModel.findById(alice.id).lean();
      expect(stored).toMatchObject({ name: 'Alice', email: alice.email, role: 'user' });
    });

    it('works for accounts without a password too', async () => {
      const gina = await googleUser();
      const { status, body } = await api('PATCH', '/api/me', gina, { name: 'Gina G.' });
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ name: 'Gina G.', hasPassword: false });
    });
  });

  describe('POST /api/me/password', () => {
    const change = (user: TestUser, body: unknown, headers?: Record<string, string>) => api('POST', '/api/me/password', user, body, headers);

    it('validates the body with the reset-password rules', async () => {
      const cases: unknown[] = [
        {},
        { currentPassword: alice.password },
        { currentPassword: '', newPassword: NEW_PASSWORD },
        { currentPassword: alice.password, newPassword: 'Short1' },
        { currentPassword: alice.password, newPassword: 'alllowercase1' },
        { currentPassword: alice.password, newPassword: 'NoDigitsHere' },
      ];
      for (const body of cases) {
        expect((await change(alice, body)).status, JSON.stringify(body)).toBe(400);
      }
      // Nothing changed.
      expect((await login(alice.email, alice.password)).status).toBe(200);
    });

    it('refuses a wrong current password with 400 WRONG_PASSWORD (not 401)', async () => {
      const { status, body } = await change(alice, { currentPassword: 'Not-The-Password-1', newPassword: NEW_PASSWORD });
      expect(status).toBe(400);
      expect(body.code).toBe('WRONG_PASSWORD');
      expect((await login(alice.email, alice.password)).status).toBe(200);
      expect((await login(alice.email, NEW_PASSWORD)).status).toBe(401);
    });

    it('tells a Google-only account to use Forgot password (409 NO_PASSWORD)', async () => {
      const gina = await googleUser();
      const { status, body } = await change(gina, { currentPassword: 'anything', newPassword: NEW_PASSWORD });
      expect(status).toBe(409);
      expect(body.code).toBe('NO_PASSWORD');
      expect(body.details).toEqual({ ssoRequired: false });
      expect(body.message).toContain('Forgot password');
      expect((await UserModel.findById(gina.id).select('+password').lean())!.password).toBeUndefined();
    });

    it('tells an account whose organization requires SSO that its sign-in is managed (409 NO_PASSWORD)', async () => {
      const owner = await createVerifiedUser({ email: `owner@acme-${new mongoose.Types.ObjectId()}.test` });
      const domain = owner.email.split('@')[1]!;
      const workspace = await WorkspaceModel.create({
        name: 'Acme',
        slug: `acme-${new mongoose.Types.ObjectId()}`,
        type: 'team',
        ownerId: owner.id,
        settings: { requireSso: true },
      });
      await SsoConnectionModel.create({
        workspaceId: workspace._id,
        name: 'Acme IdP',
        type: 'saml',
        enabled: true,
        domains: [{ domain, token: 'txt-token', verifiedAt: new Date() }],
        saml: { idpEntityId: 'https://idp.acme.test', idpSsoUrl: 'https://idp.acme.test/sso' },
      });
      const sam = await googleUser(`sam@${domain}`);

      const { status, body } = await change(sam, { currentPassword: 'anything', newPassword: NEW_PASSWORD });
      expect(status).toBe(409);
      expect(body.code).toBe('NO_PASSWORD');
      expect(body.details).toEqual({ ssoRequired: true });
      expect(body.message).toContain('organization');
    });

    it('changes the password, ends every other session and keeps the caller signed in', async () => {
      // Another device: a real sign-in holding its own refresh cookie.
      const other = await login(alice.email, alice.password);
      const otherCookie = refreshCookie(other.res)!;
      expect(otherCookie).toBeTruthy();
      expect((await refresh(otherCookie)).status).toBe(200);

      const mail = spyOn(console, 'log');
      let result: Awaited<ReturnType<typeof change>>;
      try {
        result = await change(alice, { currentPassword: alice.password, newPassword: NEW_PASSWORD });
        await settle();
        expect(mail.mock.calls.flat().join('\n')).toContain(`[Email Mock] To: ${alice.email}, Subject: Your Open Poll password was changed`);
      } finally {
        mail.mockRestore();
      }

      expect(result.status).toBe(200);
      expect(result.body.data.user).toMatchObject({ _id: alice.id, hasPassword: true });
      expect(result.body.data.user).not.toHaveProperty('password');
      const { accessToken } = result.body.data;
      expect(typeof accessToken).toBe('string');
      const freshCookie = refreshCookie(result.res)!;
      expect(freshCookie).toBeTruthy();
      expect(freshCookie).not.toBe(otherCookie);

      // The other device's refresh token is dead; the caller's new one works.
      expect((await refresh(otherCookie)).status).toBe(401);
      expect((await refresh(freshCookie)).status).toBe(200);
      const me = await api('GET', '/api/auth/me', null, undefined, { authorization: `Bearer ${accessToken}` });
      expect(me.body.data).toMatchObject({ email: alice.email });

      // The old password fails, the new one works.
      expect((await login(alice.email, alice.password)).status).toBe(401);
      expect((await login(alice.email, NEW_PASSWORD)).status).toBe(200);

      const events = await AuditEventModel.find({ action: 'account.password_change' }).lean();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorType: 'user', targetType: 'user', targetId: alice.id });
      expect(String(events[0]!.actorId)).toBe(alice.id);
    });

    it('voids a reset link issued before the change', async () => {
      await UserModel.updateOne(
        { _id: alice.id },
        { $set: { resetPasswordToken: 'pending-hash', resetPasswordExpires: new Date(Date.now() + 60_000) } },
      );
      expect((await change(alice, { currentPassword: alice.password, newPassword: NEW_PASSWORD })).status).toBe(200);
      const stored = await UserModel.findById(alice.id).select('+resetPasswordToken +resetPasswordExpires').lean();
      expect(stored!.resetPasswordToken).toBeUndefined();
      expect(stored!.resetPasswordExpires).toBeUndefined();
    });

    it('is rate limited per user', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await change(alice, { currentPassword: `Wrong-Guess-${i}`, newPassword: NEW_PASSWORD })).status);
      }
      expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
      // Another user is not affected.
      const bob = await createVerifiedUser({ name: 'Bob' });
      expect((await change(bob, { currentPassword: 'Wrong-Guess-x', newPassword: NEW_PASSWORD })).status).toBe(400);
    }, 30_000);
  });
});
