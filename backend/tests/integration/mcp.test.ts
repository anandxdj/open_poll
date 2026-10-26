import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';
import { createVerifiedUser, type TestUser } from './fixtures';

/**
 * The MCP surface through the real app: an SDK client over Streamable HTTP
 * against /mcp, authenticated the way a connector is.
 */

let server: TestServer;

async function issueToken(user: TestUser, body: Record<string, unknown> = {}) {
  const res = await server.request('/api/mcp/tokens', {
    method: 'POST',
    headers: user.headers,
    body: { label: 'Integration', ...body },
  });
  const json = (await res.json()) as any;
  if (res.status !== 201) throw new Error(`issue token → ${res.status}: ${json.message}`);
  return json.data.token as string;
}

async function connect(token: string) {
  const client = new Client({ name: 'integration', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

/** Calls a tool and returns its parsed JSON result, throwing the error text on isError. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as any;
  const text = result.content?.[0]?.text ?? '';
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

describeIntegration('MCP over Streamable HTTP', () => {
  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  it('serves a stateless session to a personal access token', async () => {
    const owner = await createVerifiedUser({ name: 'Ada' });
    const client = await connect(await issueToken(owner));

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('get_context');

    const context = await call(client, 'get_context');
    expect(context.user.name).toBe('Ada');
    expect(context.workspace.role).toBe('owner');
    expect(context.workspace.pinned).toBe(false);
    await client.close();
  });
});
