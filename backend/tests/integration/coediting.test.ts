import { afterAll, beforeAll, beforeEach, expect, it, describe } from 'bun:test';
import { PresentationModel } from '../../src/modules/presentations/presentations.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Co-editing safety (W3-B2): the deck `revision`, `If-Match` on the whole-deck
 * PATCH and on the slide-level routes (409 DECK_CHANGED when stale), slide ids
 * kept across saves, and slide edits without `If-Match` that both survive.
 */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: Record<string, unknown>; data: T };

const heading = (title: string) => ({ type: 'heading', content: { title, subtitle: '' } });

describeIntegration('co-editing: revisions and slide-level edits over HTTP', () => {
  let server: TestServer;
  let alice!: TestUser; // owner of Alpha
  let erin!: TestUser; // editor in Alpha
  let carol!: TestUser; // viewer in Alpha
  let bob!: TestUser; // another workspace
  let wsA!: string;
  let deckId!: string;

  const call = async <T = any>(user: TestUser, method: string, path: string, options: { body?: unknown; ifMatch?: string } = {}) => {
    const headers: Record<string, string> = { ...user.headers, 'X-Workspace-Id': user === bob ? '' : wsA };
    if (user === bob) delete headers['X-Workspace-Id'];
    if (options.ifMatch !== undefined) headers['If-Match'] = options.ifMatch;
    const res = await server.request(path, { method, headers, body: options.body });
    return { status: res.status, body: (await res.json().catch(() => null)) as Body<T> };
  };
  const deckPath = () => `/api/presentations/${deckId}`;
  const read = async (user: TestUser = alice) => (await call(user, 'GET', deckPath())).body.data;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(async () => {
    await resetTestData();
    [alice, erin, carol, bob] = await Promise.all([
      createVerifiedUser({ name: 'Alice' }),
      createVerifiedUser({ name: 'Erin' }),
      createVerifiedUser({ name: 'Carol' }),
      createVerifiedUser({ name: 'Bob' }),
    ]);
    const res = await server.request('/api/workspaces', { method: 'POST', headers: alice.headers, body: { name: 'Alpha' } });
    wsA = ((await res.json()) as Body).data.workspace._id;
    await WorkspaceModel.updateOne({ _id: wsA }, { $set: { plan: 'team' } });
    await WorkspaceMemberModel.create([
      { workspaceId: wsA, userId: erin.id, role: 'editor' },
      { workspaceId: wsA, userId: carol.id, role: 'viewer' },
    ]);
    const deck = await createPresentation(server, { ...alice, headers: { ...alice.headers, 'x-workspace-id': wsA } as TestUser['headers'] }, {
      title: 'Shared deck',
      slides: [heading('One'), heading('Two'), heading('Three')],
    });
    deckId = deck._id;
  });

  it('starts at revision 0 and refuses a save based on a revision someone else already replaced', async () => {
    const opened = await read();
    expect(opened.revision).toBe(0);

    // Alice and Erin both opened revision 0. Alice saves first.
    const first = await call(alice, 'PATCH', deckPath(), { body: { title: 'Alice was here', slides: opened.slides }, ifMatch: '"0"' });
    expect(first.status).toBe(200);
    expect(first.body.data.revision).toBe(1);

    const second = await call(erin, 'PATCH', deckPath(), { body: { title: 'Erin overwrites', slides: opened.slides }, ifMatch: '"0"' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DECK_CHANGED');
    expect(second.body.details).toEqual({ revision: 1 });
    expect((await read()).title).toBe('Alice was here');

    // After reloading she has the current revision and can save.
    const retried = await call(erin, 'PATCH', deckPath(), { body: { title: 'Erin, after reload' }, ifMatch: '1' });
    expect(retried.status).toBe(200);
    expect(retried.body.data.revision).toBe(2);

    // Without If-Match the old behaviour stays (MCP, older clients): last write wins.
    expect((await call(alice, 'PATCH', deckPath(), { body: { title: 'No precondition' } })).status).toBe(200);
    expect((await call(alice, 'PATCH', deckPath(), { body: { title: 'x' }, ifMatch: 'abc' })).body.code).toBe('INVALID_IF_MATCH');
  });

  it('counts only title and slide changes: theme and settings saves do not make the builder stale', async () => {
    const opened = await read();
    expect((await call(erin, 'PATCH', deckPath(), { body: { theme: { presetId: 'ocean' } } })).status).toBe(200);
    expect((await call(erin, 'PATCH', deckPath(), { body: { settings: { qna: { enabled: true } } } })).status).toBe(200);
    expect((await call(erin, 'PATCH', deckPath(), { body: { title: opened.title } })).body.data.revision).toBe(0);
    const save = await call(alice, 'PATCH', deckPath(), { body: { slides: opened.slides }, ifMatch: String(opened.revision) });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(save.body.data.revision).toBe(1);
  });

  it('keeps slide ids the client sends back, so slide-level edits keep working after a full save', async () => {
    const opened = await read();
    const [one, two, three] = opened.slides;
    const saved = await call(alice, 'PATCH', deckPath(), {
      body: { slides: [three, { ...one, content: { title: 'One, edited', subtitle: '' } }, { ...two, _id: one._id }, heading('Four')] },
    });
    expect(saved.status).toBe(200);
    const ids = saved.body.data.slides.map((slide: { _id: string }) => slide._id);
    expect(ids[0]).toBe(three._id);
    expect(ids[1]).toBe(one._id);
    expect(ids[2]).not.toBe(one._id); // a repeated id gets a new one
    expect(new Set(ids).size).toBe(4);
    expect(saved.body.data.slides[1].content.title).toBe('One, edited');
  });

  it('adds, edits, reorders and deletes single slides with If-Match', async () => {
    const opened = await read();
    const inserted = await call(erin, 'POST', `${deckPath()}/slides`, { body: { slide: heading('Inserted'), index: 1 }, ifMatch: '"0"' });
    expect(inserted.status, JSON.stringify(inserted.body)).toBe(201);
    expect(inserted.body.data.revision).toBe(1);
    expect(inserted.body.data.slides.map((slide: { content: { title: string } }) => slide.content.title)).toEqual(['One', 'Inserted', 'Two', 'Three']);
    const newId = inserted.body.data.slideId as string;
    expect(inserted.body.data.slides[1]._id).toBe(newId);

    const patched = await call(erin, 'PATCH', `${deckPath()}/slides/${newId}`, {
      body: { content: { title: 'Inserted and edited' }, notes: 'Say hello' },
      ifMatch: '"1"',
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.slides[1]).toMatchObject({ _id: newId, notes: 'Say hello', content: { title: 'Inserted and edited' } });
    expect(patched.body.data.revision).toBe(2);

    // A type change is validated against the new type.
    const badType = await call(erin, 'PATCH', `${deckPath()}/slides/${newId}`, { body: { type: 'select_answer' }, ifMatch: '2' });
    expect(badType.status).toBe(400);
    const retyped = await call(erin, 'PATCH', `${deckPath()}/slides/${newId}`, {
      body: { type: 'wordcloud', question: 'A word?', timeLimit: 0 },
      ifMatch: '2',
    });
    expect(retyped.status, JSON.stringify(retyped.body)).toBe(200);
    expect(retyped.body.data.slides[1]).toMatchObject({ _id: newId, type: 'wordcloud', kind: 'interactive' });

    const order = [...retyped.body.data.slides].reverse().map((slide: { _id: string }) => slide._id);
    const reordered = await call(alice, 'POST', `${deckPath()}/slides/reorder`, { body: { order }, ifMatch: '3' });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.slides.map((slide: { _id: string }) => slide._id)).toEqual(order);

    const removed = await call(alice, 'DELETE', `${deckPath()}/slides/${opened.slides[0]._id}`, { ifMatch: '4' });
    expect(removed.status).toBe(200);
    expect(removed.body.data.slides).toHaveLength(3);
    expect(removed.body.data.revision).toBe(5);
  });

  it('answers a stale If-Match on every slide route with 409 DECK_CHANGED and changes nothing', async () => {
    const opened = await read();
    expect((await call(alice, 'PATCH', deckPath(), { body: { title: 'Bumped' } })).body.data.revision).toBe(1);
    const slideId = opened.slides[0]._id;
    const attempts = [
      await call(erin, 'POST', `${deckPath()}/slides`, { body: { slide: heading('Late') }, ifMatch: '0' }),
      await call(erin, 'PATCH', `${deckPath()}/slides/${slideId}`, { body: { notes: 'late' }, ifMatch: '0' }),
      await call(erin, 'DELETE', `${deckPath()}/slides/${slideId}`, { ifMatch: '0' }),
      await call(erin, 'POST', `${deckPath()}/slides/reorder`, { body: { order: opened.slides.map((s: { _id: string }) => s._id) }, ifMatch: '0' }),
    ];
    for (const attempt of attempts) {
      expect(attempt.status).toBe(409);
      expect(attempt.body).toMatchObject({ code: 'DECK_CHANGED', details: { revision: 1 } });
    }
    const after = await read();
    expect(after.revision).toBe(1);
    expect(after.slides.map((slide: { _id: string }) => slide._id)).toEqual(opened.slides.map((slide: { _id: string }) => slide._id));
  });

  it('merges concurrent slide edits sent without If-Match instead of losing one', async () => {
    const opened = await read();
    const edits = opened.slides.map((slide: { _id: string }, index: number) =>
      call(index % 2 ? erin : alice, 'PATCH', `${deckPath()}/slides/${slide._id}`, { body: { notes: `note ${index}` } }),
    );
    const results = await Promise.all(edits);
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(200);
    const after = await read();
    expect(after.slides.map((slide: { notes: string }) => slide.notes)).toEqual(['note 0', 'note 1', 'note 2']);
    expect(after.revision).toBe(3);
  });

  it('refuses malformed slide edits, the last slide, unknown slides, viewers, other workspaces and live decks', async () => {
    const opened = await read();
    const ids = opened.slides.map((slide: { _id: string }) => slide._id);
    expect((await call(alice, 'POST', `${deckPath()}/slides/reorder`, { body: { order: ids.slice(0, 2) } })).body.code).toBe('DECK_CHANGED');
    expect((await call(alice, 'POST', `${deckPath()}/slides/reorder`, { body: { order: [ids[0], ids[0], ids[1]] } })).status).toBe(400);
    expect((await call(alice, 'PATCH', `${deckPath()}/slides/${'f'.repeat(24)}`, { body: { notes: 'x' } })).body.code).toBe('SLIDE_NOT_FOUND');
    expect((await call(alice, 'PATCH', `${deckPath()}/slides/${ids[0]}`, { body: {} })).status).toBe(400);
    expect((await call(alice, 'POST', `${deckPath()}/slides`, { body: { slide: { type: 'nope' } } })).status).toBe(400);

    await call(alice, 'DELETE', `${deckPath()}/slides/${ids[0]}`);
    await call(alice, 'DELETE', `${deckPath()}/slides/${ids[1]}`);
    expect((await call(alice, 'DELETE', `${deckPath()}/slides/${ids[2]}`)).body.code).toBe('LAST_SLIDE');

    expect((await call(carol, 'PATCH', `${deckPath()}/slides/${ids[2]}`, { body: { notes: 'viewer' } })).status).toBe(403);
    expect((await call(carol, 'POST', `${deckPath()}/slides`, { body: { slide: heading('viewer') } })).status).toBe(403);
    expect([403, 404]).toContain((await call(bob, 'PATCH', `${deckPath()}/slides/${ids[2]}`, { body: { notes: 'bob' } })).status);
    expect([403, 404]).toContain((await call(bob, 'POST', `${deckPath()}/slides/reorder`, { body: { order: [ids[2]] } })).status);

    await PresentationModel.updateOne({ _id: deckId }, { $set: { status: 'active' } });
    expect((await call(alice, 'POST', `${deckPath()}/slides`, { body: { slide: heading('live') } })).status).toBe(400);
    const notes = (await PresentationModel.findById(deckId).lean())!.slides.map((slide) => slide.notes);
    expect(notes).toEqual(['']);
  });
});
