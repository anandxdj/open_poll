import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import type { Socket as ClientSocket } from 'socket.io-client';
import { redisClient } from '../../src/common/config/redis';
import { presenceKey, PRESENCE_STALE_MS, readEditors } from '../../src/modules/presentations/editor.socket';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Builder presence (W3-B2, `presentations/editor.socket.ts`) over real sockets
 * and Redis: `deck:join` for editors only, `presence:update` to the others when
 * someone opens or leaves the deck, one entry per user, stale entries dropped.
 */

type Editors = { userId: string; name: string; since: string; tabs: number }[];

describeIntegration('builder presence over Socket.io', () => {
  let server: TestServer;
  let alice!: TestUser; // owner
  let erin!: TestUser; // editor
  let carol!: TestUser; // viewer
  let bob!: TestUser; // another workspace
  let deckId!: string;

  const connect = async () => {
    const socket = server.connectSocket();
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  };
  const join = (socket: ClientSocket, user: TestUser | null, presentationId = deckId) =>
    socket.timeout(3000).emitWithAck('deck:join', { presentationId, ...(user ? { accessToken: user.accessToken } : {}) }) as Promise<
      { ok: true; editors: Editors } | { ok: false; error: string }
    >;
  /** The next `presence:update` for the deck whose editor names match `names`. */
  const nextUpdate = (socket: ClientSocket, names: string[]) =>
    new Promise<Editors>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no presence:update with ${names.join(', ')}`)), 3000);
      const onUpdate = (event: { presentationId: string; editors: Editors }) => {
        if (event.presentationId !== deckId) return;
        const got = event.editors.map((editor) => editor.name);
        if (JSON.stringify(got) !== JSON.stringify(names)) return;
        clearTimeout(timer);
        socket.off('presence:update', onUpdate);
        resolve(event.editors);
      };
      socket.on('presence:update', onUpdate);
    });

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
    const wsA = ((await res.json()) as { data: { workspace: { _id: string } } }).data.workspace._id;
    await WorkspaceModel.updateOne({ _id: wsA }, { $set: { plan: 'team' } });
    await WorkspaceMemberModel.create([
      { workspaceId: wsA, userId: erin.id, role: 'editor' },
      { workspaceId: wsA, userId: carol.id, role: 'viewer' },
    ]);
    deckId = (await createPresentation(server, { ...alice, headers: { ...alice.headers, 'x-workspace-id': wsA } as TestUser['headers'] }))._id;
  });

  it('tells each editor who else has the deck open, and when they leave', async () => {
    const aliceSocket = await connect();
    const first = await join(aliceSocket, alice);
    expect(first).toMatchObject({ ok: true, editors: [{ userId: alice.id, name: 'Alice' }] });

    const erinArrives = nextUpdate(aliceSocket, ['Alice', 'Erin']);
    const erinSocket = await connect();
    const second = await join(erinSocket, erin);
    expect(second.ok && second.editors.map((editor) => editor.name)).toEqual(['Alice', 'Erin']);
    await erinArrives;

    // A heartbeat (same socket again) answers with the list and announces nothing new.
    expect((await join(aliceSocket, alice)).ok).toBe(true);
    // A second tab of the same user counts once.
    const aliceTab = await connect();
    expect((await join(aliceTab, alice)).ok && (await readEditors(deckId)).map((editor) => [editor.name, editor.tabs])).toEqual([
      ['Alice', 2],
      ['Erin', 1],
    ]);
    aliceTab.disconnect();

    const erinLeaves = nextUpdate(aliceSocket, ['Alice']);
    erinSocket.disconnect();
    await erinLeaves;

    aliceSocket.emit('deck:leave', { presentationId: deckId });
    for (let i = 0; i < 50 && (await redisClient.hLen(presenceKey(deckId))) > 0; i++) await Bun.sleep(20);
    expect(await redisClient.hLen(presenceKey(deckId))).toBe(0);
  });

  it('only lets people who may edit the deck join', async () => {
    const socket = await connect();
    expect(await join(socket, carol)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await join(socket, bob)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await join(socket, null)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(await join(socket, alice, 'not-an-id')).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    expect(await join(socket, { ...alice, accessToken: 'forged' })).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(await readEditors(deckId)).toEqual([]);
  });

  it('drops editors whose heartbeat stopped', async () => {
    const now = Date.now();
    await redisClient.hSet(presenceKey(deckId), 'ghost-socket', JSON.stringify({ userId: bob.id, name: 'Ghost', since: now - 600_000, at: now - PRESENCE_STALE_MS - 1 }));
    await redisClient.hSet(presenceKey(deckId), 'live-socket', JSON.stringify({ userId: erin.id, name: 'Erin', since: now - 1000, at: now - 1000 }));
    expect((await readEditors(deckId, now)).map((editor) => editor.name)).toEqual(['Erin']);
    expect(await redisClient.hExists(presenceKey(deckId), 'ghost-socket')).toBe(0);
  });
});
