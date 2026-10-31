import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { PresentationModel, PresentationSessionModel } from '../../src/modules/presentations/presentations.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** W3-A: theme presets, brand kit CRUD with plan gate and contrast check, deck themes and the session snapshot. */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: any; data: T };

const KIT = {
  name: 'Acme',
  colors: {
    background: '#0a1f44',
    surface: '#13295a',
    text: '#ffffff',
    mutedText: '#b8c4dc',
    accent: '#ffcc00',
    accentText: '#1a1400',
    correct: '#4ade80',
    incorrect: '#fb7185',
    chart: ['#FFCC00', '#38bdf8'],
  },
  fonts: { heading: 'Montserrat', body: 'Inter' },
  logo: { url: 'https://cdn.example.com/acme.png', alt: 'Acme' },
};

describeIntegration('themes and brand kits over HTTP', () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;

  const api = async <T = any>(method: string, path: string, user: TestUser | null = alice, body?: unknown) => {
    const res = await server.request(path, { method, headers: user ? user.headers : {}, body });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  const personal = async (user: TestUser) => (await WorkspaceModel.findOne({ ownerId: user.id, type: 'personal' }).lean())!;
  const setPlan = async (user: TestUser, plan: string) =>
    WorkspaceModel.updateOne({ ownerId: user.id, type: 'personal' }, { $set: { plan } });

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice' });
    bob = await createVerifiedUser({ name: 'Bob' });
    await api('GET', '/api/presentations', alice);
    await api('GET', '/api/presentations', bob);
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('lists the built-in themes and fonts to any signed-in user', async () => {
    expect((await api('GET', '/api/themes/presets', null)).status).toBe(401);
    const { status, body } = await api('GET', '/api/themes/presets');
    expect(status).toBe(200);
    expect(body.data.presets[0]).toMatchObject({ id: 'graph-paper', name: 'Graph paper', tokens: { custom: false } });
    expect(body.data.presets.map((p: { id: string }) => p.id)).toContain('ocean');
    expect(body.data.fonts).toContain('Montserrat');
  });

  it('keeps brand kits to plans that include them', async () => {
    const res = await api('POST', '/api/brand-kits', alice, KIT);
    expect([res.status, res.body.code]).toEqual([403, 'FEATURE_NOT_IN_PLAN']);
    expect((await api('GET', '/api/brand-kits')).status).toBe(403);
  });

  it('creates, reads, updates and deletes a kit, checking contrast', async () => {
    await setPlan(alice, 'pro');
    const created = await api('POST', '/api/brand-kits', alice, KIT);
    expect(created.status).toBe(201);
    const kit = created.body.data;
    expect(kit.colors.chart).toEqual(['#ffcc00', '#38bdf8']);
    expect(kit.tokens).toMatchObject({ brandKitId: kit.id, custom: true, name: 'Acme' });
    expect(kit.tokens.fonts.heading.url).toContain('family=Montserrat');
    expect((await api('GET', '/api/brand-kits')).body.data.map((k: { id: string }) => k.id)).toEqual([kit.id]);

    const unreadable = await api('PATCH', `/api/brand-kits/${kit.id}`, alice, { colors: { ...KIT.colors, text: '#13295a' } });
    expect([unreadable.status, unreadable.body.code]).toEqual([400, 'LOW_CONTRAST']);
    expect(unreadable.body.details.failures.map((f: { foreground: string; background: string }) => `${f.foreground}/${f.background}`)).toEqual([
      'text/background',
      'text/surface',
    ]);

    const renamed = await api('PATCH', `/api/brand-kits/${kit.id}`, alice, { name: 'Acme 2026', logo: null });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: 'Acme 2026', logo: null });

    expect((await api('DELETE', `/api/brand-kits/${kit.id}`)).status).toBe(200);
    expect((await api('GET', `/api/brand-kits/${kit.id}`)).status).toBe(404);
    const actions = (await AuditEventModel.find({ targetType: 'brand_kit' }).lean()).map((e) => e.action).sort();
    expect(actions).toEqual(['brand_kit.create', 'brand_kit.delete', 'brand_kit.update']);
  });

  it('rejects bad input', async () => {
    await setPlan(alice, 'pro');
    const bad = await api('POST', '/api/brand-kits', alice, { ...KIT, colors: { ...KIT.colors, accent: 'yellow' } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('#rrggbb');
    expect((await api('POST', '/api/brand-kits', alice, { ...KIT, fonts: { heading: 'Comic Sans', body: 'Inter' } })).status).toBe(400);
    expect((await api('POST', '/api/brand-kits', alice, { ...KIT, logo: { url: 'javascript:alert(1)', alt: '' } })).status).toBe(400);
  });

  it('never shows one workspace another workspace’s kit', async () => {
    await setPlan(alice, 'pro');
    await setPlan(bob, 'pro');
    const kit = (await api('POST', '/api/brand-kits', alice, KIT)).body.data;
    expect((await api('GET', `/api/brand-kits/${kit.id}`, bob)).status).toBe(404);
    expect((await api('PATCH', `/api/brand-kits/${kit.id}`, bob, { name: 'Mine now' })).status).toBe(404);
    expect((await api('DELETE', `/api/brand-kits/${kit.id}`, bob)).status).toBe(404);
    expect((await api('GET', '/api/brand-kits', bob)).body.data).toEqual([]);

    const deck = await createPresentation(server, bob, { title: 'Bob deck' });
    const stolen = await api('PATCH', `/api/presentations/${deck._id}`, bob, { theme: { brandKitId: kit.id } });
    expect(stolen.status).toBe(404);
  });

  it('applies a deck theme and snapshots it when a session opens', async () => {
    await setPlan(alice, 'pro');
    const kit = (await api('POST', '/api/brand-kits', alice, KIT)).body.data;
    const deck = await createPresentation(server, alice, { title: 'Branded deck' });

    expect((await api('PATCH', `/api/presentations/${deck._id}`, alice, { theme: { presetId: 'neon' } })).status).toBe(400);
    const lowAccent = await api('PATCH', `/api/presentations/${deck._id}`, alice, {
      theme: { overrides: { accent: '#ffcc00', accentText: '#ffd84d' } },
    });
    expect([lowAccent.status, lowAccent.body.code]).toEqual([400, 'LOW_CONTRAST']);

    const saved = await api('PATCH', `/api/presentations/${deck._id}`, alice, {
      theme: { presetId: 'ocean', brandKitId: kit.id, overrides: { accent: '#38BDF8', accentText: '#04202f' } },
    });
    expect(saved.status).toBe(200);
    const stored = await PresentationModel.findById(deck._id).lean();
    expect(stored!.theme).toMatchObject({ presetId: 'ocean', overrides: { accent: '#38bdf8', accentText: '#04202f' } });
    expect(String(stored!.theme.brandKitId)).toBe(kit.id);

    const opened = await api('POST', `/api/presentations/${deck._id}/host/open-lobby`);
    expect(opened.status).toBe(200);
    expect(opened.body.data.session.theme).toMatchObject({
      brandKitId: kit.id,
      name: 'Acme',
      custom: true,
      colors: { background: '#0a1f44', accent: '#38bdf8', accentText: '#04202f' },
      logo: { url: 'https://cdn.example.com/acme.png', alt: 'Acme' },
    });
    const code = await api('GET', `/api/presentations/code/${stored!.joinCode}`, null);
    expect(code.body.data.theme.brandKitId).toBe(kit.id);

    // Editing or deleting the kit later never restyles the session that already opened.
    await api('DELETE', `/api/brand-kits/${kit.id}`);
    expect((await PresentationModel.findById(deck._id).lean())!.theme.brandKitId).toBeNull();
    const session = await PresentationSessionModel.findOne({ presentationId: deck._id }).lean();
    expect((session!.themeSnapshot as { name: string }).name).toBe('Acme');
  });

  it('falls back to the preset when the plan loses brand kits', async () => {
    await setPlan(alice, 'pro');
    const kit = (await api('POST', '/api/brand-kits', alice, KIT)).body.data;
    const deck = await createPresentation(server, alice, { title: 'Downgraded' });
    await api('PATCH', `/api/presentations/${deck._id}`, alice, { theme: { presetId: 'forest', brandKitId: kit.id } });
    await setPlan(alice, 'free');
    const again = await api('PATCH', `/api/presentations/${deck._id}`, alice, { theme: { brandKitId: kit.id } });
    expect([again.status, again.body.code]).toEqual([403, 'FEATURE_NOT_IN_PLAN']);
    const opened = await api('POST', `/api/presentations/${deck._id}/host/open-lobby`);
    expect(opened.body.data.session.theme).toMatchObject({ presetId: 'forest', brandKitId: null, name: 'Forest' });
  });

  it('starts new decks on the workspace default theme', async () => {
    await setPlan(alice, 'pro');
    const kit = (await api('POST', '/api/brand-kits', alice, KIT)).body.data;
    const workspace = await personal(alice);
    const set = await api('PATCH', `/api/workspaces/${workspace._id}`, alice, {
      settings: { defaultTheme: { presetId: 'grape', brandKitId: kit.id } },
    });
    expect(set.status).toBe(200);
    expect(set.body.data.workspace.settings.defaultTheme).toEqual({ presetId: 'grape', brandKitId: kit.id });

    const deck = await createPresentation(server, alice, { title: 'New deck' });
    const stored = await PresentationModel.findById(deck._id).lean();
    expect(stored!.theme.presetId).toBe('grape');
    expect(String(stored!.theme.brandKitId)).toBe(kit.id);

    // Deleting the kit clears it from the default too.
    await api('DELETE', `/api/brand-kits/${kit.id}`);
    expect((await personal(alice)).settings.defaultTheme).toEqual({ presetId: 'grape', brandKitId: null });
  });
});
