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

  it('drafts a deck with every slide kind and edits it by slide id', async () => {
    const owner = await createVerifiedUser();
    const client = await connect(await issueToken(owner));

    const { kinds } = await call(client, 'list_slide_types');
    const created = await call(client, 'create_deck', {
      title: 'Every kind',
      slides: kinds.map((kind: any) => kind.example),
    });
    expect(created.deck.status).toBe('draft');
    expect(created.deck.slides.map((slide: any) => slide.kind)).toEqual(kinds.map((kind: any) => kind.kind));
    expect(created.deck.links.builder).toContain(`/presentation/create?id=${created.deck.id}`);

    const deckId = created.deck.id;
    const [first, second, third] = created.deck.slides;

    const updated = await call(client, 'update_slide', {
      deckId,
      slideId: second.id,
      slide: { kind: 'wordcloud', question: 'One word for today?', notes: 'Read out the biggest word' },
    });
    expect(updated.slide).toMatchObject({ id: second.id, position: 1, kind: 'wordcloud', question: 'One word for today?' });

    const reordered = await call(client, 'reorder_slides', {
      deckId,
      slideIds: [third.id, first.id, second.id, ...created.deck.slides.slice(3).map((slide: any) => slide.id)],
    });
    expect(reordered.slides.slice(0, 3).map((slide: any) => slide.id)).toEqual([third.id, first.id, second.id]);

    const added = await call(client, 'add_slides', {
      deckId,
      position: 0,
      slides: [{ kind: 'heading', title: 'Welcome' }],
    });
    expect(added.added[0]).toMatchObject({ position: 0, kind: 'heading' });
    expect(added.warnings[0]).toContain('no speaker notes');

    const removed = await call(client, 'remove_slides', { deckId, slideIds: [first.id] });
    expect(removed.slides.some((slide: any) => slide.id === first.id)).toBe(false);
    expect(removed.slides.some((slide: any) => slide.id === second.id)).toBe(true);

    const themed = await call(client, 'update_deck', { deckId, theme: { presetId: 'ocean' } });
    expect(themed.theme.presetId).toBe('ocean');
    await client.close();
  });

  it('rejects a draft with every invalid slide listed and stores nothing', async () => {
    const owner = await createVerifiedUser();
    const client = await connect(await issueToken(owner));

    await expect(
      call(client, 'create_deck', {
        title: 'Broken',
        slides: [
          { kind: 'heading', title: 'Fine' },
          { kind: 'guess_number', question: 'Pick', min: 10, max: 5 },
        ],
      }),
    ).rejects.toThrow('slides[1] (guess_number)');
    expect((await call(client, 'list_decks')).total).toBe(0);
    await client.close();
  });
});
