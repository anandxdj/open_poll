import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mockRes } from './helpers/http';

// Record outgoing mail instead of sending it.
const sent: { kind: string; to: string }[] = [];
mock.module('../src/common/config/email', () => ({
  sendVerificationEmail: async (to: string) => void sent.push({ kind: 'verification', to }),
  sendResetPasswordEmail: async (to: string) => void sent.push({ kind: 'reset', to }),
  sendAccountExistsEmail: async (to: string) => void sent.push({ kind: 'account-exists', to }),
  // mock.module is process-wide: keep every export other suites import.
  sendWorkspaceInviteEmail: async () => false,
}));

const { UserModel } = await import('../src/modules/auth/auth.model');
const { AuthService } = await import('../src/modules/auth/auth.service');
const { AuthController, AUTH_MESSAGES } = await import('../src/modules/auth/auth.controller');
const { registerSchema } = await import('../src/modules/auth/dto/register.schema');
const { loginSchema } = await import('../src/modules/auth/dto/login.schema');
const { forgotPasswordSchema } = await import('../src/modules/auth/dto/forgot-password.schema');
const { resendVerificationSchema } = await import('../src/modules/auth/dto/resend-verification.schema');

const original = { findOne: UserModel.findOne, create: UserModel.create };
let created: any[] = [];

const flushBackgroundMail = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A stored account as findOne would return it. */
const existingUser = (overrides: Record<string, unknown> = {}) => {
  const doc = UserModel.hydrate({
    _id: '64b000000000000000000001',
    email: 'owner@example.com',
    name: 'Owner',
    role: 'user',
    isVerified: true,
    ...overrides,
  });
  (doc as any).save = async () => doc;
  return doc;
};

const findOneReturning = (doc: unknown) => {
  (UserModel as any).findOne = () => {
    const result = Promise.resolve(doc) as any;
    result.select = () => Promise.resolve(doc);
    return result;
  };
};

beforeEach(() => {
  sent.length = 0;
  created = [];
  (UserModel as any).create = async (data: any) => {
    created.push(data);
    return data;
  };
});

afterEach(() => {
  (UserModel as any).findOne = original.findOne;
  (UserModel as any).create = original.create;
});

afterAll(() => {
  mock.restore();
});

describe('auth DTOs', () => {
  it('register strips a client-supplied role', () => {
    const parsed = registerSchema.parse({ name: 'Mallory', email: 'm@example.com', password: 'Passw0rdX', role: 'admin' });
    expect('role' in parsed).toBe(false);
  });

  it('normalizes mixed-case, padded emails instead of rejecting them', () => {
    const email = '  Alice@Example.COM ';
    expect(registerSchema.parse({ name: 'Alice', email, password: 'Passw0rdX' }).email).toBe('alice@example.com');
    expect(loginSchema.parse({ email, password: 'x' }).email).toBe('alice@example.com');
    expect(forgotPasswordSchema.parse({ email }).email).toBe('alice@example.com');
    expect(resendVerificationSchema.parse({ email }).email).toBe('alice@example.com');
  });
});

describe('AuthService.register', () => {
  it('always creates a plain user, even if a role reaches the service', async () => {
    findOneReturning(null);
    await AuthService.register({ email: 'new@example.com', name: 'New', password: 'Passw0rdX', role: 'admin' } as any);
    expect(created).toHaveLength(1);
    expect(created[0].role).toBe('user');
    expect(created[0].isVerified).toBe(false);
  });

  it('does not create a duplicate and emails the existing owner instead', async () => {
    findOneReturning(existingUser());
    await AuthService.register({ email: 'owner@example.com', name: 'X', password: 'Passw0rdX' });
    await flushBackgroundMail();
    expect(created).toHaveLength(0);
    expect(sent).toEqual([{ kind: 'account-exists', to: 'owner@example.com' }]);
  });
});

describe('uniform responses (no account enumeration)', () => {
  const callController = async (handler: (req: any, res: any, next: any) => Promise<unknown>, body: any) => {
    const res = mockRes();
    let error: unknown;
    await handler({ body, params: {} }, res, (err: unknown) => (error = err));
    expect(error).toBeUndefined();
    return { status: res.statusCode, body: res.body };
  };

  it('register answers identically for new and existing emails', async () => {
    findOneReturning(null);
    const fresh = await callController(AuthController.register, { email: 'new@example.com', name: 'New', password: 'Passw0rdX' });
    findOneReturning(existingUser());
    const taken = await callController(AuthController.register, { email: 'owner@example.com', name: 'X', password: 'Passw0rdX' });

    expect(taken).toEqual(fresh);
    expect(fresh).toEqual({ status: 201, body: { success: true, message: AUTH_MESSAGES.register, data: null } });
  });

  it('forgot-password answers identically for known and unknown emails', async () => {
    findOneReturning(null);
    const unknown = await callController(AuthController.forgotPassword, { email: 'nobody@example.com' });
    findOneReturning(existingUser());
    const known = await callController(AuthController.forgotPassword, { email: 'owner@example.com' });
    await flushBackgroundMail();

    expect(known).toEqual(unknown);
    expect(unknown.body.message).toBe(AUTH_MESSAGES.forgotPassword);
    expect(sent).toEqual([{ kind: 'reset', to: 'owner@example.com' }]);
  });

  it('resend-verification answers identically for unknown, verified and unverified accounts', async () => {
    findOneReturning(null);
    const unknown = await callController(AuthController.resendVerification, { email: 'nobody@example.com' });
    findOneReturning(existingUser({ isVerified: true }));
    const verified = await callController(AuthController.resendVerification, { email: 'owner@example.com' });
    findOneReturning(existingUser({ isVerified: false }));
    const pending = await callController(AuthController.resendVerification, { email: 'owner@example.com' });
    await flushBackgroundMail();

    expect(verified).toEqual(unknown);
    expect(pending).toEqual(unknown);
    expect(unknown.body.message).toBe(AUTH_MESSAGES.resendVerification);
    expect(sent).toEqual([{ kind: 'verification', to: 'owner@example.com' }]);
  });

  it('login gives the same error for unknown emails and wrong passwords', async () => {
    findOneReturning(null);
    const unknown = await AuthService.login({ email: 'nobody@example.com', password: 'x' }).catch((e) => e);
    findOneReturning(existingUser({ password: '$2b$12$m4daYAiMWvh.MRFjcFKTeOzM0qFhjU101NDgsvIEM7qHIQvdl71j.' }));
    const wrong = await AuthService.login({ email: 'owner@example.com', password: 'wrong' }).catch((e) => e);

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.message).toBe(wrong.message);
  });
});
