import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import migration from '../../src/migrations/240-deck-theme-mode';
import { setDeckLlm } from '../../src/modules/ai/deck/llm';
import { PresentationModel, PresentationSessionModel } from '../../src/modules/presentations/presentations.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Light deck themes: a deck stores light or dark (`theme.mode`). New decks are
 * light unless the request says otherwise (the builder sends the app theme in
 * use), every create path carries it (create, AI deck, template use, convert),
 * duplicate keeps the source's, the deck read and save answers carry the
 * resolved tokens, the host state the deck's current theme next to the
 * session's snapshot (a running session keeps its snapshot), the library card a
 * preview, the remote its theme. Migration 240 sets the mode of older decks
 * (dark when they chose a look, else light), run twice.
 */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: any; data: T };

const SLIDES = [
  { type: 'heading', content: { title: 'Welcome' } },
  { type: 'wordcloud', question: 'One word', timeLimit: 0 },
];
const DEVICE = 'device-key-aaaaaaaaaaaaaaaaaaaaaaaa';

describeIntegration('deck light and dark themes', () => {
  let server: TestServer;
  let alice: TestUser;

  const api = async <T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = alice.headers) => {
    const res = await server.request(path, { method, headers, body });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };
  const createDeck = async (extra: Record<string, unknown> = {}) => {
    const res = await api('POST', '/api/presentations', { title: 'Themed deck', slides: SLIDES, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
  };
  const stored = async (id: string) => (await PresentationModel.findById(id).lean())!;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice' });
    await api('GET', '/api/presentations');
    setDeckLlm(null);
  });

  afterEach(() => setDeckLlm(undefined));

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('creates light decks by default and keeps an explicit mode, with the resolved tokens', async () => {
    const plain = await createDeck();
    expect(plain.theme).toMatchObject({ presetId: 'graph-paper', mode: 'light', brandKitId: null, overrides: null });
    expect(plain.themeTokens).toMatchObject({ presetId: 'graph-paper', mode: 'light', custom: false, colors: { background: '#f6f6f3' } });
    expect((await stored(plain._id)).theme.mode).toBe('light');

    const dark = await createDeck({ theme: { mode: 'dark' } });
    expect((await stored(dark._id)).theme).toMatchObject({ presetId: 'graph-paper', mode: 'dark' });
    const read = await api('GET', `/api/presentations/${dark._id}`);
    expect(read.body.data.themeTokens).toMatchObject({ mode: 'dark', custom: false, colors: { background: '#141413' } });

    const ocean = await createDeck({ theme: { presetId: 'ocean', mode: 'light' } });
    expect(ocean.themeTokens).toMatchObject({ presetId: 'ocean', mode: 'light', custom: true, colors: { background: '#f1f6fa', accent: '#0369a1' } });

    expect((await api('POST', '/api/presentations', { title: 'Bad', slides: SLIDES, theme: { mode: 'sepia' } })).status).toBe(400);
  });

  it('takes the workspace default look and the creator\'s mode', async () => {
    await WorkspaceModel.updateOne(
      { ownerId: alice.id, type: 'personal' },
      { $set: { 'settings.defaultTheme': { presetId: 'grape', brandKitId: null } } }
    );
    const darkGrape = await createDeck({ theme: { mode: 'dark' } });
    expect((await stored(darkGrape._id)).theme).toMatchObject({ presetId: 'grape', mode: 'dark' });
    expect(darkGrape.themeTokens).toMatchObject({ presetId: 'grape', mode: 'dark', colors: { background: '#17121f' } });
    const lightGrape = await createDeck();
    expect((await stored(lightGrape._id)).theme).toMatchObject({ presetId: 'grape', mode: 'light' });
    // Picking a preset replaces the default look; the mode still applies.
    const forest = await createDeck({ theme: { presetId: 'forest', mode: 'dark' } });
    expect((await stored(forest._id)).theme).toMatchObject({ presetId: 'forest', mode: 'dark' });
  });

  it('switches a deck between light and dark without touching its revision', async () => {
    const deck = await createDeck();
    const toDark = await api('PATCH', `/api/presentations/${deck._id}`, { theme: { mode: 'dark' } });
    expect(toDark.status, JSON.stringify(toDark.body)).toBe(200);
    expect(toDark.body.data.theme).toMatchObject({ presetId: 'graph-paper', mode: 'dark' });
    expect(toDark.body.data.themeTokens).toMatchObject({ mode: 'dark', colors: { background: '#141413' } });
    expect(toDark.body.data.revision).toBe(deck.revision);
    // Changing the preset keeps the mode.
    const ocean = await api('PATCH', `/api/presentations/${deck._id}`, { theme: { presetId: 'ocean' } });
    expect(ocean.body.data.theme).toMatchObject({ presetId: 'ocean', mode: 'dark' });
    expect(ocean.body.data.themeTokens.colors.background).toBe('#0b1622');
    expect((await api('PATCH', `/api/presentations/${deck._id}`, { theme: { mode: 'dim' } })).status).toBe(400);
  });

  it('keeps the source mode on duplicate and save as template, and takes the creator\'s on template use', async () => {
    const source = await createDeck({ theme: { presetId: 'classic', mode: 'dark' } });
    const copy = await api('POST', `/api/presentations/${source._id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.data.theme).toMatchObject({ presetId: 'classic', mode: 'dark' });
    expect(copy.body.data.themeTokens.mode).toBe('dark');

    const template = await api('POST', '/api/templates', { presentationId: source._id });
    expect(template.status, JSON.stringify(template.body)).toBe(201);
    expect((await stored(template.body.data._id)).theme).toMatchObject({ presetId: 'classic', mode: 'dark' });

    const usedLight = await api('POST', `/api/templates/${template.body.data._id}/use`, { themeMode: 'light' });
    expect(usedLight.status, JSON.stringify(usedLight.body)).toBe(201);
    expect((await stored(usedLight.body.data._id)).theme).toMatchObject({ presetId: 'classic', mode: 'light' });
    const usedAsIs = await api('POST', `/api/templates/${template.body.data._id}/use`, {});
    expect((await stored(usedAsIs.body.data._id)).theme.mode).toBe('dark');

    const starterDark = await api('POST', '/api/templates/team-retro/use', { themeMode: 'dark' });
    expect(starterDark.status).toBe(201);
    expect((await stored(starterDark.body.data._id)).theme).toMatchObject({ presetId: 'graph-paper', mode: 'dark' });
    const starterDefault = await api('POST', '/api/templates/team-retro/use', {});
    expect((await stored(starterDefault.body.data._id)).theme.mode).toBe('light');
    expect((await api('POST', '/api/templates/team-retro/use', { themeMode: 'neon' })).status).toBe(400);
  });

  it('creates AI decks in the requested mode, light without one', async () => {
    const dark = await api('POST', '/api/ai/generate-deck', { topic: 'Zero trust', slideCount: 4, themeMode: 'dark' });
    expect(dark.status, JSON.stringify(dark.body)).toBe(201);
    expect((await stored(dark.body.data.presentation._id)).theme.mode).toBe('dark');
    const plain = await api('POST', '/api/ai/generate-deck', { topic: 'Zero trust', slideCount: 4 });
    expect((await stored(plain.body.data.presentation._id)).theme.mode).toBe('light');
  });

  it('snapshots the mode when a session opens; a running session keeps it while the deck changes', async () => {
    const deck = await createDeck({ theme: { mode: 'dark' } });
    const pid = deck._id;
    const before = await api('GET', `/api/presentations/${pid}/host/state`);
    expect(before.body.data.session).toBeNull();
    expect(before.body.data.deckTheme).toMatchObject({ mode: 'dark', custom: false });

    const lobby = await api('POST', `/api/presentations/${pid}/host/open-lobby`);
    expect(lobby.status, JSON.stringify(lobby.body)).toBe(200);
    expect(lobby.body.data.session.theme).toMatchObject({ mode: 'dark' });

    // A live deck is not edited (theme included); the theme stored in the deck changing behind the
    // session's back (a raw write here) does not restyle it either: it draws its snapshot.
    expect((await api('PATCH', `/api/presentations/${pid}`, { theme: { mode: 'light' } })).status).toBe(400);
    await PresentationModel.updateOne({ _id: pid }, { $set: { 'theme.mode': 'light' } });
    const during = await api('GET', `/api/presentations/${pid}/host/state`);
    expect(during.body.data.session.theme.mode).toBe('dark');
    expect(during.body.data.deckTheme.mode).toBe('light');
    const joined = await api('POST', `/api/presentations/${pid}/join`, { name: 'Ada' }, {});
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    const { participantId, token } = joined.body.data;
    const live = await api('GET', `/api/presentations/${pid}/live-state?participantId=${participantId}&token=${token}`, undefined, {});
    expect(live.body.data.theme.mode).toBe('dark');
    const code = await api('GET', `/api/presentations/code/${deck.joinCode}`, undefined, {});
    expect(code.body.data.theme.mode).toBe('dark');
    const session = await PresentationSessionModel.findOne({ presentationId: pid }).lean();
    expect((session!.themeSnapshot as { mode: string }).mode).toBe('dark');

    // The next session takes the deck's theme as it is then.
    await api('POST', `/api/presentations/${pid}/host/end`);
    const again = await api('POST', `/api/presentations/${pid}/host/open-lobby`);
    expect(again.body.data.session.theme.mode).toBe('light');
  });

  it('gives the phone remote the stage theme', async () => {
    const deck = await createDeck({ theme: { presetId: 'ocean', mode: 'dark' } });
    const pid = deck._id;
    const created = await api('POST', `/api/presentations/${pid}/host/remote-token`);
    expect(created.status).toBe(201);
    const remote = await api('GET', `/api/remote/${created.body.data.token}/state`, undefined, { 'X-Remote-Device': DEVICE });
    expect(remote.status).toBe(200);
    expect(remote.body.data.theme).toMatchObject({ presetId: 'ocean', mode: 'dark' });
  });

  it('previews each deck\'s theme on its library card', async () => {
    const light = await createDeck();
    const dark = await createDeck({ theme: { presetId: 'mono', mode: 'dark' } });
    const page = await api('GET', '/api/library?type=presentation');
    expect(page.status).toBe(200);
    const card = (id: string) => page.body.data.items.find((item: { id: string }) => item.id === id).details.theme;
    expect(card(light._id)).toMatchObject({ mode: 'light', custom: false, background: '#f6f6f3' });
    expect(card(dark._id)).toMatchObject({ mode: 'dark', custom: true, background: '#111111' });
  });

  it('migration 240 makes chosen looks dark and the plain default light, and is idempotent', async () => {
    const db = mongoose.connection.db!;
    const decks = db.collection('presentations');
    const base = { creatorId: alice.id, title: 'Old', slides: [], status: 'draft', createdAt: new Date(), updatedAt: new Date() };
    const id = () => new mongoose.Types.ObjectId();
    const ids = { plain: id(), noTheme: id(), nullTheme: id(), ocean: id(), kit: id(), accent: id(), amber: id(), unknown: id(), already: id() };
    await decks.insertMany([
      { ...base, _id: ids.plain, joinCode: '100001', theme: { presetId: 'graph-paper', brandKitId: null, overrides: null } },
      { ...base, _id: ids.noTheme, joinCode: '100002' },
      { ...base, _id: ids.nullTheme, joinCode: '100003', theme: null },
      { ...base, _id: ids.ocean, joinCode: '100004', theme: { presetId: 'ocean', brandKitId: null, overrides: null } },
      { ...base, _id: ids.kit, joinCode: '100005', theme: { presetId: 'graph-paper', brandKitId: id(), overrides: null } },
      { ...base, _id: ids.accent, joinCode: '100006', theme: { presetId: 'graph-paper', brandKitId: null, overrides: { accent: '#38bdf8', accentText: '#04202f' } } },
      { ...base, _id: ids.amber, joinCode: '100007', theme: { presetId: 'amber', brandKitId: null, overrides: null } },
      { ...base, _id: ids.unknown, joinCode: '100008', theme: { presetId: 'neon', brandKitId: null, overrides: null } },
      { ...base, _id: ids.already, joinCode: '100009', theme: { presetId: 'ocean', mode: 'light', brandKitId: null, overrides: null } },
    ]);

    const run = () => migration.up({ db, connection: mongoose.connection, log: () => {} });
    await run();
    const after = new Map((await decks.find({ _id: { $in: Object.values(ids) } }).toArray()).map((deck) => [String(deck._id), deck.theme]));
    await run();
    const twice = new Map((await decks.find({ _id: { $in: Object.values(ids) } }).toArray()).map((deck) => [String(deck._id), deck.theme]));
    expect(twice).toEqual(after);

    const mode = (key: keyof typeof ids) => after.get(String(ids[key]))?.mode;
    expect(mode('plain')).toBe('light');
    expect(mode('noTheme')).toBe('light');
    expect(mode('nullTheme')).toBe('light');
    expect(mode('amber')).toBe('light');
    expect(mode('unknown')).toBe('light');
    expect(mode('ocean')).toBe('dark');
    expect(mode('kit')).toBe('dark');
    expect(mode('accent')).toBe('dark');
    expect(mode('already')).toBe('light');
    // Nothing else of the theme changes.
    expect(after.get(String(ids.ocean))).toEqual({ presetId: 'ocean', brandKitId: null, overrides: null, mode: 'dark' });
    expect(after.get(String(ids.accent))!.overrides).toEqual({ accent: '#38bdf8', accentText: '#04202f' });
  });
});
