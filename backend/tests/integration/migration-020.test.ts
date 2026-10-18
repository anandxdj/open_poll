import { afterAll, beforeAll, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import migration020 from '../../src/migrations/020-workspaces';
import { runMigrations, type MigrationContext } from '../../src/migrations/runner';
import { ensurePersonalWorkspace } from '../../src/modules/workspaces/provisioning';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

const { ObjectId } = mongoose.Types;

/** 020-workspaces on fixture data written with raw collection operations, as pre-workspace data was. */
describeIntegration('migration 020-workspaces', () => {
  let server: TestServer;
  let context: MigrationContext;
  const logs: string[] = [];

  const db = () => mongoose.connection.db!;
  const users = () => db().collection('users');
  const polls = () => db().collection('polls');
  const presentations = () => db().collection('presentations');
  const workspaces = () => db().collection('workspaces');
  const members = () => db().collection('workspacemembers');

  const alice = new ObjectId();
  const bob = new ObjectId();
  const carol = new ObjectId();
  const dave = new ObjectId();
  const ghost = new ObjectId();
  const carolsTeam = new ObjectId();
  let bobsPersonal: string;

  beforeAll(async () => {
    server = await startTestServer();
    await resetTestData();
    context = { db: db(), connection: mongoose.connection, log: (line) => logs.push(line) };

    const user = (_id: InstanceType<typeof ObjectId>, name: string, fields: Record<string, unknown> = {}) => ({
      _id,
      name,
      email: `${name.toLowerCase()}-${_id}@example.com`,
      role: 'user',
      isVerified: true,
      ...fields,
    });
    await users().insertMany([
      user(alice, 'Alice'),
      user(bob, 'Bob'),
      user(carol, 'Carol', { defaultWorkspaceId: carolsTeam }),
      user(dave, 'Dave'),
    ]);
    // Bob already went through lazy provisioning.
    bobsPersonal = String((await ensurePersonalWorkspace({ _id: bob, name: 'Bob' })).workspace._id);
    await workspaces().insertOne({ _id: carolsTeam, name: 'Team', slug: `team-${carolsTeam}`, type: 'team', ownerId: carol });
    await members().insertOne({ workspaceId: carolsTeam, userId: carol, role: 'owner', status: 'active' });

    const poll = (creatorId: unknown, title: string, fields: Record<string, unknown> = {}) => ({ creatorId, title, questions: [], ...fields });
    await polls().insertMany([
      poll(String(alice), 'Alice 1'),
      poll(String(alice), 'Alice 2', { workspaceId: null }),
      poll(alice, 'Alice (ObjectId creator)'),
      poll(String(bob), 'Bob 1'),
      poll(String(carol), 'Carol in team', { workspaceId: carolsTeam }),
      poll(String(carol), 'Carol unscoped'),
      poll(String(ghost), 'Orphan'),
    ]);
    await presentations().insertMany([
      { creatorId: String(alice), title: 'Alice deck', joinCode: 'A1', slides: [] },
      { creatorId: String(bob), title: 'Bob deck', joinCode: 'B1', slides: [] },
      { creatorId: String(carol), title: 'Carol team deck', joinCode: 'C1', slides: [], workspaceId: carolsTeam },
    ]);
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  const personalOf = async (ownerId: InstanceType<typeof ObjectId>) => {
    const found = await workspaces().find({ ownerId, type: 'personal' }).toArray();
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  async function snapshot() {
    const strip = (docs: any[]) => docs.map(({ _id, title, name, workspaceId, defaultWorkspaceId, role, status, userId }) =>
      JSON.stringify({ _id, title, name, workspaceId, defaultWorkspaceId, role, status, userId }),
    );
    return {
      users: strip(await users().find().sort({ _id: 1 }).toArray()),
      polls: strip(await polls().find().sort({ _id: 1 }).toArray()),
      presentations: strip(await presentations().find().sort({ _id: 1 }).toArray()),
      workspaces: strip(await workspaces().find().sort({ _id: 1 }).toArray()),
      members: strip(await members().find().sort({ _id: 1 }).toArray()),
    };
  }

  it('gives every user a personal workspace and scopes their content to it', async () => {
    await migration020.up(context);

    const alicesPersonal = await personalOf(alice);
    expect(alicesPersonal.name).toBe("Alice's workspace");
    expect(String((await personalOf(bob))._id)).toBe(bobsPersonal);
    const carolsPersonal = await personalOf(carol);
    await personalOf(dave);

    for (const owner of [alice, bob, carol, dave]) {
      const personal = await personalOf(owner);
      expect(await members().findOne({ workspaceId: personal._id, userId: owner })).toMatchObject({ role: 'owner', status: 'active' });
    }

    const byTitle = async (title: string) => String((await polls().findOne({ title }))!.workspaceId ?? null);
    expect(await byTitle('Alice 1')).toBe(String(alicesPersonal._id));
    expect(await byTitle('Alice 2')).toBe(String(alicesPersonal._id));
    expect(await byTitle('Alice (ObjectId creator)')).toBe(String(alicesPersonal._id));
    expect(await byTitle('Bob 1')).toBe(bobsPersonal);
    expect(await byTitle('Carol unscoped')).toBe(String(carolsPersonal._id));
    // Already scoped content never moves; content of unknown users stays unscoped.
    expect(await byTitle('Carol in team')).toBe(String(carolsTeam));
    expect(await byTitle('Orphan')).toBe('null');

    const deck = async (title: string) => String((await presentations().findOne({ title }))!.workspaceId);
    expect(await deck('Alice deck')).toBe(String(alicesPersonal._id));
    expect(await deck('Bob deck')).toBe(bobsPersonal);
    expect(await deck('Carol team deck')).toBe(String(carolsTeam));

    const defaults = async (id: InstanceType<typeof ObjectId>) => String((await users().findOne({ _id: id }))!.defaultWorkspaceId);
    expect(await defaults(alice)).toBe(String(alicesPersonal._id));
    expect(await defaults(bob)).toBe(bobsPersonal);
    // An existing default (here a team workspace) is kept.
    expect(await defaults(carol)).toBe(String(carolsTeam));

    expect((await polls().indexes()).some((index) => index.key.workspaceId === 1 && index.key.createdAt === -1)).toBe(true);
    expect(logs.join('\n')).toContain('polls: 5 scoped, 1 left unscoped');
    expect(logs.join('\n')).toContain('presentations: 2 scoped');
  });

  it('is idempotent: running it again (directly or through the runner) changes nothing', async () => {
    const before = await snapshot();
    logs.length = 0;
    await migration020.up(context);
    expect(await snapshot()).toEqual(before);
    expect(logs.join('\n')).toContain('personal workspaces created: 0');
    expect(logs.join('\n')).toContain('polls: 0 scoped');

    expect(await runMigrations({ migrations: [migration020] })).toEqual({ applied: [20], skipped: [] });
    expect(await runMigrations({ migrations: [migration020] })).toEqual({ applied: [], skipped: [20] });
    expect(await snapshot()).toEqual(before);
  });
});
