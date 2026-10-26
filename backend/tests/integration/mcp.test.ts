import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describeIntegration, resetTestData, settleLiveEngine, startTestServer, type TestServer } from './harness';
import { createVerifiedUser, type TestUser } from './fixtures';
import { McpTokenModel } from '../../src/modules/mcp/mcp.token.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';

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

type Joined = { participantId: string; token: string; sessionId: string };

/** A participant joins the deck's live session the way a phone does. */
async function join(deckId: string, name: string): Promise<Joined> {
  const res = await server.request(`/api/presentations/${deckId}/join`, { method: 'POST', body: { name } });
  const json = (await res.json()) as any;
  if (res.status !== 200) throw new Error(`join → ${res.status}: ${json.message}`);
  return json.data;
}

async function answer(deckId: string, who: Joined, slideIndex: number, body: Record<string, unknown>) {
  const res = await server.request(`/api/presentations/${deckId}/answer`, {
    method: 'POST',
    body: { participantId: who.participantId, participantToken: who.token, slideIndex, ...body },
  });
  if (res.status !== 200) throw new Error(`answer → ${res.status}: ${((await res.json()) as any).message}`);
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

    // Edit tools advertise a light slide shape but validate the full contract.
    await expect(
      call(client, 'update_slide', { deckId, slideId: second.id, slide: { kind: 'wordcloud' } }),
    ).rejects.toThrow('slide.question');

    const resource = await client.readResource({ uri: `openpoll://decks/${deckId}` });
    expect(JSON.parse((resource.contents[0] as { text: string }).text).deck.id).toBe(deckId);
    const prompt = await client.getPrompt({ name: 'quiz_from_document', arguments: { document: 'Bun is a runtime.' } });
    expect((prompt.messages[0]!.content as { text: string }).text).toContain('<document>\nBun is a runtime.\n</document>');
    await client.close();
  });

  it('runs a deck live with a room and reads the results back', async () => {
    const owner = await createVerifiedUser({ name: 'Host' });
    const client = await connect(await issueToken(owner));

    const created = await call(client, 'create_deck', {
      title: 'Friday retro',
      slides: [
        { kind: 'heading', title: 'Friday retro' },
        {
          kind: 'multiple_choice_quiz',
          question: '2 + 2?',
          options: [
            { text: '4', isCorrect: true },
            { text: '5', isCorrect: false },
          ],
          timeLimit: 60,
        },
        { kind: 'wordcloud', question: 'One word for the week?', timeLimit: 0 },
        { kind: 'open_ended', question: 'What should we stop doing?', timeLimit: 0 },
        { kind: 'leaderboard' },
      ],
    });
    const deckId = created.deck.id;

    const lobby = await call(client, 'open_lobby', { deckId });
    expect(lobby.join.url).toEndWith(`/live/${created.deck.joinCode}`);
    expect(lobby.session.status).toBe('lobby');
    await expect(call(client, 'open_lobby', { deckId })).rejects.toThrow('restart: true');

    const people = await Promise.all(['Ana', 'Ben', 'Cy'].map((name) => join(deckId, name)));
    expect((await call(client, 'get_live_state', { deckId })).session.participantCount).toBe(3);

    expect((await call(client, 'start_session', { deckId })).session.current.kind).toBe('heading');
    expect((await call(client, 'next_slide', { deckId })).session.current.kind).toBe('multiple_choice_quiz');
    await Promise.all(people.map((who, i) => answer(deckId, who, 1, { optionIndex: i === 2 ? 1 : 0 })));
    const revealed = await call(client, 'reveal_results', { deckId });
    expect(revealed.results.counts).toEqual([2, 1]);
    expect(revealed.leaderboard.map((row: any) => row.name).sort()).toEqual(['Ana', 'Ben', 'Cy']);

    await call(client, 'next_slide', { deckId });
    await Promise.all(people.map((who, i) => answer(deckId, who, 2, { entries: [i === 2 ? 'busy' : 'calm'] })));
    await call(client, 'next_slide', { deckId });
    await Promise.all(people.map((who, i) => answer(deckId, who, 3, { text: `long meetings ${i}` })));
    expect((await call(client, 'previous_slide', { deckId })).session.current.position).toBe(2);
    await call(client, 'go_to_slide', { deckId, position: 4 });
    await expect(call(client, 'next_slide', { deckId })).rejects.toThrow('last slide');

    const ended = await call(client, 'end_session', { deckId });
    expect(ended.session.isLive).toBe(false);
    await settleLiveEngine();

    const results = await call(client, 'get_session_results', { deckId });
    expect(results.session.participantCount).toBe(3);
    const byKind = Object.fromEntries(results.slides.map((slide: any) => [slide.kind, slide]));
    expect(byKind.multiple_choice_quiz.results.counts).toEqual([2, 1]);
    expect(byKind.wordcloud.results.words).toContainEqual({ text: 'calm', count: 2 });
    expect(byKind.open_ended.results.responses).toHaveLength(3);
    expect(results.leaderboard[0]).toMatchObject({ rank: 1, correctCount: 1 });
    expect(results.note).toContain('typed by audience members');
    const serialized = JSON.stringify(results);
    for (const who of people) expect(serialized).not.toContain(who.participantId);

    const sessions = await call(client, 'list_sessions', { deckId });
    expect(sessions.sessions[0].sessionId).toBe(ended.session.sessionId);
    const insights = await call(client, 'get_insights');
    expect(insights.totals.sessions).toBe(1);
    await client.close();
  });

  it('acts only in the workspace a token is pinned to, within the role there', async () => {
    const owner = await createVerifiedUser({ name: 'Owner' });
    const teammate = await createVerifiedUser({ name: 'Teammate' });
    const team = await WorkspaceModel.create({ name: 'Acme', slug: `acme-${Date.now()}`, type: 'team', ownerId: owner.id, plan: 'team' });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: owner.id, role: 'owner' });
    const teammateMembership = await WorkspaceMemberModel.create({ workspaceId: team._id, userId: teammate.id, role: 'presenter' });

    // The owner's default workspace stays their personal one; this token is pinned to the team.
    const pinned = await connect(await issueToken(owner, { workspaceId: String(team._id) }));
    const teamDeck = await call(pinned, 'create_deck', { title: 'Team deck', slides: [{ kind: 'heading', title: 'Hi' }] });
    expect((await call(pinned, 'get_context')).workspace).toMatchObject({ id: String(team._id), pinned: true });
    const poll = await call(pinned, 'create_poll', { title: 'Team poll', questions: [{ text: 'Lunch spot?', options: ['Tacos', 'Ramen'] }] });
    expect(poll.poll.workspaceId).toBe(String(team._id));

    const personal = await connect(await issueToken(owner));
    const personalDeck = await call(personal, 'create_deck', { title: 'Personal deck', slides: [{ kind: 'heading', title: 'Hi' }] });
    expect((await call(personal, 'list_decks')).decks.map((deck: any) => deck.title)).toEqual(['Personal deck']);
    await expect(call(pinned, 'get_deck', { deckId: personalDeck.deck.id })).rejects.toThrow();
    await expect(call(personal, 'open_lobby', { deckId: teamDeck.deck.id })).rejects.toThrow();

    // A presenter may run the team deck but not edit it.
    const presenter = await connect(await issueToken(teammate, { workspaceId: String(team._id) }));
    await expect(call(presenter, 'create_deck', { title: 'Nope', slides: [{ kind: 'heading', title: 'Hi' }] })).rejects.toThrow();
    await expect(call(presenter, 'update_deck', { deckId: teamDeck.deck.id, title: 'Renamed' })).rejects.toThrow();
    expect((await call(presenter, 'open_lobby', { deckId: teamDeck.deck.id })).session.status).toBe('lobby');
    await call(presenter, 'end_session', { deckId: teamDeck.deck.id });

    // Removed from the workspace: the next call is refused.
    await WorkspaceMemberModel.updateOne({ _id: teammateMembership._id }, { status: 'suspended' });
    await expect(call(presenter, 'list_decks')).rejects.toThrow('not a member of this workspace');
    for (const client of [pinned, personal, presenter]) await client.close();
  });

  it('keeps tokens from before decks to the poll tools', async () => {
    const owner = await createVerifiedUser();
    const token = await issueToken(owner);
    await McpTokenModel.updateOne({ userId: owner.id }, { scopes: ['poll:create', 'poll:edit', 'poll:read', 'analytics:read'] });
    const client = await connect(token);
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('create_deck');
    // Unlisted, so the SDK answers before the dispatcher's own scope check would.
    await expect(call(client, 'create_deck', { title: 'X', slides: [{ kind: 'heading', title: 'Hi' }] })).rejects.toThrow(
      'Tool create_deck not found',
    );
    expect((await call(client, 'get_context')).note).toContain('Generate a new token');
    await client.close();
  });

  it('refuses a slide edit when the deck changed since it was read', async () => {
    const owner = await createVerifiedUser();
    const client = await connect(await issueToken(owner));
    const created = await call(client, 'create_deck', { title: 'Race', slides: [{ kind: 'heading', title: 'One' }] });
    const results = await Promise.allSettled(
      ['Two', 'Three', 'Four'].map((title) => call(client, 'add_slides', { deckId: created.deck.id, slides: [{ kind: 'heading', title }] })),
    );
    const saved = results.filter((result) => result.status === 'fulfilled').length;
    for (const result of results) {
      if (result.status === 'rejected') expect(String(result.reason)).toContain('changed since it was read');
    }
    // Every edit that reported success is in the deck; none was silently lost.
    expect((await call(client, 'get_deck', { deckId: created.deck.id })).deck.slides).toHaveLength(1 + saved);
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
