import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { env } from '../../src/common/config/env';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';
import { createVerifiedUser, type TestUser } from './fixtures';

/**
 * Remote MCP connectors end to end: discovery from a 401, dynamic client
 * registration, authorization with PKCE through the consent API, tokens,
 * refresh rotation, and disconnecting from settings.
 */

let server: TestServer;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const pkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

async function register(metadata: Record<string, unknown> = {}) {
  const res = await server.request('/oauth/register', {
    method: 'POST',
    body: {
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...metadata,
    },
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** /oauth/authorize → the consent page's request id. */
async function authorize(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    resource: `${server.baseUrl}/mcp`,
    ...extra,
  });
  const res = await server.request(`/oauth/authorize?${query}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const location = res.headers.get('location')!;
  expect(location.startsWith(`${env.FRONTEND_URL}/oauth/consent?request=`)).toBe(true);
  return new URL(location).searchParams.get('request')!;
}

async function consent(user: TestUser, requestId: string, action: 'approve' | 'deny', body?: Record<string, unknown>) {
  const res = await server.request(`/api/oauth/requests/${requestId}/${action}`, {
    method: 'POST',
    headers: user.headers,
    body: body ?? {},
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function token(fields: Record<string, string>) {
  const res = await server.request('/oauth/token', form(fields));
  return { status: res.status, body: (await res.json()) as any };
}

/** Registration, consent for `scopes` in the user's default workspace, and the code exchange. */
async function connectApp(user: TestUser, scopes = ['deck:read', 'deck:write', 'results:read']) {
  const client = await register();
  const { verifier, challenge } = pkce();
  const requestId = await authorize(client.body.client_id, challenge, { scope: scopes.join(' ') });
  const view = await server.request(`/api/oauth/requests/${requestId}`, { headers: user.headers });
  const { data } = (await view.json()) as any;
  const approved = await consent(user, requestId, 'approve', { workspaceId: data.defaultWorkspaceId, scopes });
  expect(approved.status).toBe(200);
  const code = new URL(approved.body.data.redirectUrl).searchParams.get('code')!;
  const tokens = await token({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: client.body.client_id,
    redirect_uri: REDIRECT,
  });
  expect(tokens.status).toBe(200);
  return { clientId: client.body.client_id as string, tokens: tokens.body, workspaceId: data.defaultWorkspaceId as string };
}

async function mcpClient(accessToken: string) {
  const client = new Client({ name: 'oauth-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

const mcpStatus = async (accessToken: string) =>
  (
    await server.request('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
  ).status;

describeIntegration('MCP OAuth 2.1 for remote connectors', () => {
  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  it('points an unauthenticated client at the metadata documents', async () => {
    const res = await server.request('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate')!;
    expect(challenge).toContain(`resource_metadata="${server.baseUrl}/.well-known/oauth-protected-resource/mcp"`);

    const resource = (await (await server.request('/.well-known/oauth-protected-resource/mcp')).json()) as any;
    expect(resource.resource).toBe(`${server.baseUrl}/mcp`);
    expect(resource.authorization_servers).toEqual([server.baseUrl]);

    const metadata = (await (await server.request('/.well-known/oauth-authorization-server')).json()) as any;
    expect(metadata).toMatchObject({
      issuer: server.baseUrl,
      authorization_endpoint: `${server.baseUrl}/oauth/authorize`,
      token_endpoint: `${server.baseUrl}/oauth/token`,
      registration_endpoint: `${server.baseUrl}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
    expect(metadata.scopes_supported).toContain('session:run');

    // Browser-based clients read these from other origins.
    const cors = await server.request('/.well-known/oauth-authorization-server', { headers: { origin: 'https://inspector.example' } });
    expect(cors.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('refuses clients that register unsafe redirect addresses', async () => {
    expect((await register({ redirect_uris: ['javascript:alert(1)'] })).status).toBe(400);
    expect((await register({ redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
    expect((await register({ redirect_uris: ['http://127.0.0.1:33418/callback'] })).status).toBe(201);
    expect((await register({ redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'] })).status).toBe(201);
  });

  it('connects an app with the scopes and workspace the user approves', async () => {
    const user = await createVerifiedUser({ name: 'Grace' });
    const { tokens, workspaceId } = await connectApp(user, ['deck:read', 'deck:write']);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'deck:read deck:write' });
    expect(tokens.access_token.startsWith('opoll_oat_')).toBe(true);

    const client = await mcpClient(tokens.access_token);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('create_deck');
    expect(names).not.toContain('open_lobby');
    const context = JSON.parse(((await client.callTool({ name: 'get_context', arguments: {} })) as any).content[0].text);
    expect(context).toMatchObject({ connection: 'oauth', workspace: { id: workspaceId, pinned: true } });
    await client.close();

    // Audit events are fire-and-forget.
    const deadline = Date.now() + 2000;
    while (!(await AuditEventModel.exists({ action: 'mcp.oauth_connect' })) && Date.now() < deadline) await Bun.sleep(20);
    expect(await AuditEventModel.exists({ action: 'mcp.oauth_connect', actorId: user.id })).toBeTruthy();
  });

  it('uses each code once and checks the PKCE verifier', async () => {
    const user = await createVerifiedUser();
    const client = await register();
    const { verifier, challenge } = pkce();
    const requestId = await authorize(client.body.client_id, challenge);
    const { data } = (await (await server.request(`/api/oauth/requests/${requestId}`, { headers: user.headers })).json()) as any;
    expect(data.request.client).toEqual({ name: 'Claude', redirectTo: 'claude.ai' });
    const approved = await consent(user, requestId, 'approve', { workspaceId: data.defaultWorkspaceId, scopes: ['deck:read'] });
    expect(new URL(approved.body.data.redirectUrl).searchParams.get('state')).toBe('state-123');
    const code = new URL(approved.body.data.redirectUrl).searchParams.get('code')!;

    const wrong = await token({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id: client.body.client_id });
    expect(wrong).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    // The failed attempt used the code up.
    const retry = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.body.client_id });
    expect(retry).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });

    // The request was answered once; a second answer finds nothing.
    expect((await consent(user, requestId, 'approve', { workspaceId: data.defaultWorkspaceId, scopes: ['deck:read'] })).status).toBe(404);
  });

  it('only approves workspaces the user belongs to', async () => {
    const user = await createVerifiedUser();
    const stranger = await createVerifiedUser();
    await connectApp(stranger);
    const strangerWorkspace = (await (await server.request('/api/workspaces', { headers: stranger.headers })).json()) as any;

    const client = await register();
    const requestId = await authorize(client.body.client_id, pkce().challenge);
    const denied = await consent(user, requestId, 'approve', {
      workspaceId: strangerWorkspace.data.defaultWorkspaceId,
      scopes: ['deck:read'],
    });
    expect(denied.status).toBe(403);
  });

  it('sends the user back with access_denied when they decline', async () => {
    const user = await createVerifiedUser();
    const client = await register();
    const requestId = await authorize(client.body.client_id, pkce().challenge);
    const declined = await consent(user, requestId, 'deny');
    const url = new URL(declined.body.data.redirectUrl);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('rotates refresh tokens and ends the grant when an old one comes back', async () => {
    const user = await createVerifiedUser();
    const { clientId, tokens } = await connectApp(user);

    const refreshed = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(tokens.refresh_token);
    expect(await mcpStatus(tokens.access_token)).toBe(401);
    expect(await mcpStatus(refreshed.body.access_token)).toBe(200);

    const replay = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(replay).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(await mcpStatus(refreshed.body.access_token)).toBe(401);
  });

  it('lists connected apps in settings and disconnects them', async () => {
    const user = await createVerifiedUser();
    const { tokens } = await connectApp(user);

    const list = (await (await server.request('/api/mcp/grants', { headers: user.headers })).json()) as any;
    expect(list.data.grants).toHaveLength(1);
    expect(list.data.grants[0]).toMatchObject({ clientName: 'Claude', scopes: ['deck:read', 'deck:write', 'results:read'] });

    const other = await createVerifiedUser();
    const grantId = list.data.grants[0].id;
    expect((await server.request(`/api/mcp/grants/${grantId}`, { method: 'DELETE', headers: other.headers })).status).toBe(404);
    expect((await server.request(`/api/mcp/grants/${grantId}`, { method: 'DELETE', headers: user.headers })).status).toBe(200);
    expect(await mcpStatus(tokens.access_token)).toBe(401);
  });

  it('revokes through the revocation endpoint', async () => {
    const user = await createVerifiedUser();
    const { clientId, tokens } = await connectApp(user);
    const res = await server.request('/oauth/revoke', form({ token: tokens.refresh_token, client_id: clientId }));
    expect(res.status).toBe(200);
    expect(await mcpStatus(tokens.access_token)).toBe(401);
  });
});
