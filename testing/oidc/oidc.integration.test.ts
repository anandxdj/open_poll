import { afterAll, describe, expect, test } from 'bun:test';

const backend = process.env.OIDC_TEST_BACKEND || 'http://localhost:5000';
const issuer = 'https://id-backend.anands.dev';
const clientId = 'cl_TmWZBoNuD5BIonz2hEX7m3ux';
const redirectUri = 'http://localhost:3000/api/auth/callback/id';
const transactions: string[] = [];

function cookieValue(response: Response, name: string): string {
  const header = response.headers.get('set-cookie') || '';
  const match = header.match(new RegExp(`(?:^|[,;]\\s*)${name}=([^;]+)`));
  if (!match?.[1]) throw new Error(`${name} cookie was not set`);
  return decodeURIComponent(match[1]);
}

describe('OpenPoll OIDC relying party', () => {
  test('running backend emits a complete Authorization Code + PKCE S256 request', async () => {
    const health = await fetch(`${backend}/health`);
    expect(health.status).toBe(200);

    const response = await fetch(`${backend}/api/auth/login`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    const state = cookieValue(response, 'oidc_state');
    transactions.push(state);

    const authorization = new URL(response.headers.get('location')!);
    expect(authorization.origin).toBe(issuer);
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
    expect(provider.headers.get('location')).toStartWith('https://id.anands.dev/login?return_to=');
  }, 20_000);

  test('state mismatch fails closed before token exchange', async () => {
    const start = await fetch(`${backend}/api/auth/login`, { redirect: 'manual' });
    const state = cookieValue(start, 'oidc_state');
    transactions.push(state);

    const callback = await fetch(
      `${backend}/api/auth/google/callback?code=not-a-real-code&state=wrong-state`,
      { headers: { cookie: `oidc_state=${state}` }, redirect: 'manual' },
    );
    expect(callback.status).toBe(302);
    const destination = new URL(callback.headers.get('location')!);
    expect(destination.pathname).toBe('/login');
    expect(destination.searchParams.get('error')).toBe('OpenID sign-in failed');
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
