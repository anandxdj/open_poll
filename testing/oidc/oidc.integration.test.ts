import { afterAll, describe, expect, test } from 'bun:test';

// Must match the running backend's OIDC_* settings; see README.md.
const backend = process.env.OIDC_TEST_BACKEND || 'http://localhost:5000';
const issuer = process.env.OIDC_TEST_ISSUER?.trim() || process.env.OIDC_ISSUER?.trim() || '';
const clientId = process.env.OIDC_TEST_CLIENT_ID?.trim() || process.env.OIDC_CLIENT_ID?.trim() || '';
const redirectUri = process.env.OIDC_TEST_REDIRECT_URI?.trim() || process.env.OIDC_REDIRECT_URI?.trim() || '';
const missing = [
  !issuer && 'OIDC_TEST_ISSUER',
  !clientId && 'OIDC_TEST_CLIENT_ID',
  !redirectUri && 'OIDC_TEST_REDIRECT_URI',
].filter(Boolean);
if (missing.length > 0) {
  console.warn(`[oidc integration] skipped: set ${missing.join(', ')} (or the matching OIDC_* vars). See testing/oidc/README.md.`);
}
const transactions: string[] = [];

function cookieValue(response: Response, name: string): string {
  const header = response.headers.get('set-cookie') || '';
  const match = header.match(new RegExp(`(?:^|[,;]\\s*)${name}=([^;]+)`));
  if (!match?.[1]) throw new Error(`${name} cookie was not set`);
  return decodeURIComponent(match[1]);
}

describe.skipIf(missing.length > 0)('OpenPoll OIDC relying party', () => {
  test('running backend emits a complete Authorization Code + PKCE S256 request', async () => {
    const health = await fetch(`${backend}/health`);
    expect(health.status).toBe(200);

    const response = await fetch(`${backend}/api/auth/login`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    const state = cookieValue(response, 'oidc_state');
    transactions.push(state);

    const authorization = new URL(response.headers.get('location')!);
    expect(authorization.origin).toBe(new URL(issuer).origin);
    expect(authorization.pathname).toBe('/oauth/authorize');
    expect(authorization.searchParams.get('client_id')).toBe(clientId);
    expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('scope')).toBe('openid profile email');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get('nonce')).toBeTruthy();
    expect(authorization.searchParams.get('state')).toBe(state);

    const provider = await fetch(authorization, { redirect: 'manual' });
    expect(provider.status).toBe(302);
    // Optional: where the IdP sends unauthenticated users (e.g. https://id.anands.dev/login).
    const loginUi = process.env.OIDC_TEST_LOGIN_URL?.trim();
    expect(provider.headers.get('location')).toStartWith(loginUi ? `${loginUi}?return_to=` : 'http');
  }, 20_000);

  test('state mismatch fails closed before token exchange', async () => {
    const start = await fetch(`${backend}/api/auth/login`, { redirect: 'manual' });
    const state = cookieValue(start, 'oidc_state');
    transactions.push(state);

    // Both the OIDC callback and the shared Google path must refuse a foreign state.
    for (const path of ['/auth/callback', '/api/auth/google/callback']) {
      const callback = await fetch(
        `${backend}${path}?code=not-a-real-code&state=wrong-state`,
        { headers: { cookie: `oidc_state=${state}` }, redirect: 'manual' },
      );
      expect(callback.status).toBe(302);
      const destination = new URL(callback.headers.get('location')!);
      expect(destination.pathname).toBe('/login');
      expect(['sso_failed', 'oauth_failed']).toContain(destination.searchParams.get('error'));
    }
  });

  test('state cookie is scoped to / so every registered callback path receives it', async () => {
    const response = await fetch(`${backend}/api/auth/login`, { redirect: 'manual' });
    transactions.push(cookieValue(response, 'oidc_state'));
    const header = response.headers.get('set-cookie') || '';
    expect(header).toMatch(/oidc_state=[^;]+;[^,]*Path=\/(;|$)/);
    expect(header).toMatch(/HttpOnly/i);
  });

  test('registered redirect URI mismatch is rejected by the provider', async () => {
    const request = new URL('/oauth/authorize', issuer);
    request.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:3000/not-registered',
      response_type: 'code',
      scope: 'openid profile email',
      state: 'mismatch-state',
      nonce: 'mismatch-nonce',
      code_challenge: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
      code_challenge_method: 'S256',
    }).toString();
    const response = await fetch(request, { redirect: 'manual' });
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  }, 20_000);

  test('wrong client secret fails closed at the token endpoint', async () => {
    const credentials = Buffer.from(`${clientId}:definitely-wrong-secret`).toString('base64');
    const response = await fetch(`${issuer}/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'not-a-real-code',
        redirect_uri: redirectUri,
        code_verifier: 'not-a-valid-verifier',
      }),
    });
    expect(response.status).toBe(401);
  }, 20_000);
});

afterAll(async () => {
  // Transactions expire after ten minutes; no privileged cleanup endpoint is exposed.
  transactions.length = 0;
});
