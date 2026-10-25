import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mockReq, mockRes } from './helpers/http';

// Controllable stand-in for the IdP discovery request.
const realOidc = { ...(await import('openid-client')) };
let discoveryImpl: () => Promise<unknown> = async () => ({});
let discoveryCalls = 0;
mock.module('openid-client', () => ({
  ...realOidc,
  discovery: async () => {
    discoveryCalls += 1;
    return discoveryImpl();
  },
}));

const { env } = await import('../src/common/config/env');
const { redisClient } = await import('../src/common/config/redis');
const { UserModel } = await import('../src/modules/auth/auth.model');
const { AuthService } = await import('../src/modules/auth/auth.service');
const { AuthController, GOOGLE_STATE_COOKIE, OIDC_STATE_COOKIE } = await import('../src/modules/auth/auth.controller');
const { OidcService, resetOidcConfiguration } = await import('../src/modules/auth/oidc.service');

const saved = {
  google: env.google,
  oidc: env.oidc,
  findOne: UserModel.findOne,
  handleGoogleCallback: AuthService.handleGoogleCallback,
  redisSet: redisClient.set,
  redisGet: redisClient.get,
  redisGetDel: redisClient.getDel,
  consoleError: console.error,
};
const redisStore = new Map<string, string>();

beforeEach(() => {
  redisStore.clear();
  console.error = () => {};
  env.google = { clientId: 'google-client', clientSecret: 'google-secret', redirectUri: 'http://localhost:5000/api/auth/google/callback' };
  env.oidc = { issuer: 'https://id.example', clientId: 'oidc-client', clientSecret: 'oidc-secret', redirectUri: 'http://localhost:5000/auth/callback' };
  (redisClient as any).set = async (key: string, value: string) => {
    redisStore.set(key, value);
    return 'OK';
  };
  (redisClient as any).get = async (key: string) => redisStore.get(key) ?? null;
  (redisClient as any).getDel = async (key: string) => {
    const value = redisStore.get(key) ?? null;
    redisStore.delete(key);
    return value;
  };
});

afterEach(() => {
  env.google = saved.google;
  env.oidc = saved.oidc;
  (UserModel as any).findOne = saved.findOne;
  AuthService.handleGoogleCallback = saved.handleGoogleCallback;
  (redisClient as any).set = saved.redisSet;
  (redisClient as any).get = saved.redisGet;
  (redisClient as any).getDel = saved.redisGetDel;
  console.error = saved.consoleError;
  resetOidcConfiguration();
});

afterAll(() => {
  mock.restore();
});

describe('OIDC discovery', () => {
  it('retries discovery after a failure instead of caching the rejection', async () => {
    resetOidcConfiguration();
    discoveryCalls = 0;
    discoveryImpl = async () => {
      throw new Error('IdP temporarily down');
    };
    await expect(OidcService.createAuthorizationRequest()).rejects.toThrow('IdP temporarily down');

    // Recovery: the next sign-in performs discovery again.
    discoveryImpl = async () => {
      throw new Error('still down');
    };
    await expect(OidcService.createAuthorizationRequest()).rejects.toThrow('still down');
    expect(discoveryCalls).toBe(2);
  });

  it('caches a successful discovery', async () => {
    resetOidcConfiguration();
    discoveryCalls = 0;
    discoveryImpl = async () => ({ fake: 'configuration' });
    // Discovery succeeds; building the URL from the fake config may fail, which is fine here.
    await OidcService.createAuthorizationRequest().catch(() => {});
    await OidcService.createAuthorizationRequest().catch(() => {});
    expect(discoveryCalls).toBe(1);
  });

  it('sends a browser that cannot start SSO back to /login with a code, not JSON', async () => {
    discoveryImpl = async () => {
      throw new Error('IdP down');
    };
    const res = mockRes();
    await AuthController.oidcLogin(mockReq(), res as any);
    expect(res.redirects).toEqual([`${env.FRONTEND_URL}/login?error=sso_unavailable`]);
    expect(res.body).toBeUndefined();
  });

  it('sends an expired SSO resume back to /login with a code', async () => {
    const res = mockRes();
    await AuthController.oidcContinue(mockReq({ cookies: { [OIDC_STATE_COOKIE]: 'gone' } }), res as any);
    expect(res.redirects).toEqual([`${env.FRONTEND_URL}/login?error=sso_expired`]);
  });
});

describe('OIDC account linking', () => {
  const claims = { sub: 'idp|victim', email: 'Victim@Example.com', email_verified: true, name: 'Victim' };
  const ATTACKER_HASH = '$2b$12$m4daYAiMWvh.MRFjcFKTeOzM0qFhjU101NDgsvIEM7qHIQvdl71j.';

  const localAccount = (overrides: Record<string, unknown>) =>
    UserModel.hydrate({
      _id: '64b000000000000000000002',
      email: 'victim@example.com',
      name: 'Pre-registered',
      role: 'admin',
      password: ATTACKER_HASH,
      verificationToken: 'pending-token-hash',
      resetPasswordToken: 'reset-token-hash',
      ...overrides,
    });

  const findBy = (byEmail: unknown) => {
    (UserModel as any).findOne = async (filter: Record<string, unknown>) => ('email' in filter ? byEmail : null);
  };
  const oidcSubjects = (user: any) =>
    user.identities.filter((entry: any) => entry.provider === 'oidc').map((entry: any) => entry.subject);

  it('wipes a pre-registered attacker password when claiming an unverified account', async () => {
    findBy(localAccount({ isVerified: false }));
    const user: any = await OidcService.findOrLinkUser(claims);

    expect(user.password).toBeUndefined();
    expect(user.verificationToken).toBeUndefined();
    expect(user.resetPasswordToken).toBeUndefined();
    expect(user.role).toBe('user');
    expect(user.isVerified).toBe(true);
    expect(oidcSubjects(user)).toEqual(['idp|victim']);
    // The removal is persisted, not just hidden on the in-memory doc.
    expect(user.$getChanges().$unset).toMatchObject({ password: 1, verificationToken: 1, resetPasswordToken: 1 });
  });

  it('keeps the password of an already verified local account', async () => {
    findBy(localAccount({ isVerified: true, role: 'user' }));
    const user: any = await OidcService.findOrLinkUser(claims);
    expect(user.password).toBe(ATTACKER_HASH);
    expect(oidcSubjects(user)).toEqual(['idp|victim']);
  });

  it('refuses an email already linked to a different OIDC subject', async () => {
    findBy(localAccount({ isVerified: true, role: 'user', identities: [{ provider: 'oidc', subject: 'idp|other' }] }));
    await expect(OidcService.findOrLinkUser(claims)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses claims without a verified email', async () => {
    await expect(OidcService.findOrLinkUser({ ...claims, email_verified: false })).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('Google OAuth state', () => {
  it('binds a random state to the browser and the provider redirect', async () => {
    const res = mockRes();
    await AuthController.googleLogin(mockReq(), res as any);

    const state = res.cookies[GOOGLE_STATE_COOKIE]!.value;
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(res.cookies[GOOGLE_STATE_COOKIE]!.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(new URL(res.redirects[0]!).searchParams.get('state')).toBe(state);
    expect(redisStore.has(`auth:google-state:${state}`)).toBe(true);
  });

  const startGoogle = async () => {
    const res = mockRes();
    await AuthController.googleLogin(mockReq(), res as any);
    return res.cookies[GOOGLE_STATE_COOKIE]!.value;
  };

  const trackGoogleExchange = () => {
    const calls: string[] = [];
    AuthService.handleGoogleCallback = (async (code: string) => {
      calls.push(code);
      return { user: {}, accessToken: 'access', refreshToken: 'refresh' };
    }) as any;
    return calls;
  };

  it('rejects a callback whose state does not match the cookie', async () => {
    const state = await startGoogle();
    const exchanges = trackGoogleExchange();
    const res = mockRes();
    await AuthController.googleCallback(
      mockReq({ query: { code: 'attacker-code', state: 'attacker-state' }, cookies: { [GOOGLE_STATE_COOKIE]: state } }),
      res as any,
    );
    expect(exchanges).toEqual([]);
    expect(res.redirects).toEqual([`${env.FRONTEND_URL}/login?error=google_failed`]);
  });

  it('rejects a callback without a state cookie (login CSRF)', async () => {
    const state = await startGoogle();
    const exchanges = trackGoogleExchange();
    const res = mockRes();
    await AuthController.googleCallback(mockReq({ query: { code: 'c', state } }), res as any);
    expect(exchanges).toEqual([]);
    expect(res.redirects[0]).toEndWith('/login?error=google_failed');
  });

  it('accepts the matching state exactly once', async () => {
    const state = await startGoogle();
    const exchanges = trackGoogleExchange();
    const req = () => mockReq({ query: { code: 'good-code', state }, cookies: { [GOOGLE_STATE_COOKIE]: state } });

    const first = mockRes();
    await AuthController.googleCallback(req(), first as any);
    expect(exchanges).toEqual(['good-code']);
    expect(first.redirects[0]).toStartWith(`${env.FRONTEND_URL}/auth/complete?code=`);
    expect(first.cookies.refreshToken?.value).toBe('refresh');

    const replay = mockRes();
    await AuthController.googleCallback(req(), replay as any);
    expect(exchanges).toEqual(['good-code']);
    expect(replay.redirects[0]).toEndWith('/login?error=google_failed');
  });
});

describe('shared /api/auth/google/callback routing', () => {
  it('dispatches by whichever state cookie the returned state matches', async () => {
    const exchanges: string[] = [];
    AuthService.handleGoogleCallback = (async (code: string) => {
      exchanges.push(code);
      return { user: {}, accessToken: 'a', refreshToken: 'r' };
    }) as any;
    redisStore.set('auth:google-state:g-state', '1');

    const res = mockRes();
    await AuthController.externalOAuthCallback(
      mockReq({
        query: { code: 'google-code', state: 'g-state' },
        cookies: { [OIDC_STATE_COOKIE]: 'o-state', [GOOGLE_STATE_COOKIE]: 'g-state' },
      }),
      res as any,
    );
    expect(exchanges).toEqual(['google-code']);
  });

  it('rejects a state that no flow in this browser started', async () => {
    const exchanges: string[] = [];
    AuthService.handleGoogleCallback = (async (code: string) => {
      exchanges.push(code);
      return { user: {}, accessToken: 'a', refreshToken: 'r' };
    }) as any;

    const res = mockRes();
    await AuthController.externalOAuthCallback(
      mockReq({ query: { code: 'c', state: 'forged' }, cookies: { [GOOGLE_STATE_COOKIE]: 'g-state' } }),
      res as any,
    );
    expect(exchanges).toEqual([]);
    expect(res.redirects).toEqual([`${env.FRONTEND_URL}/login?error=oauth_failed`]);
  });

  it('scopes the OIDC state cookie to / so root /auth/callback receives it', async () => {
    const res = mockRes();
    // Fake a successful authorization request without contacting an IdP.
    const original = OidcService.createAuthorizationRequest;
    OidcService.createAuthorizationRequest = (async () => ({
      url: new URL('https://id.example/oauth/authorize'),
      state: 'o-state',
      transaction: { codeVerifier: 'v', nonce: 'n', redirectUri: 'http://localhost:5000/auth/callback' },
    })) as any;
    try {
      await AuthController.oidcLogin(mockReq(), res as any);
    } finally {
      OidcService.createAuthorizationRequest = original;
    }
    expect(res.cookies[OIDC_STATE_COOKIE]).toMatchObject({ value: 'o-state', options: { path: '/', httpOnly: true, sameSite: 'lax' } });
  });
});
