import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { env } from '../../src/common/config/env';
import { redisClient } from '../../src/common/config/redis';
import type { PlanId } from '../../src/common/plans/plans';
import { ACTIVE_DOMAINS_KEY, setDomainDns } from '../../src/modules/domains/domains.service';
import { setDomainProvisioner, type DomainProvisioner } from '../../src/modules/domains/provisioners';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** W4-E: custom domain settings, DNS verification, provisioning, host resolution, TLS ask and CORS over HTTP. */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: any; data: T };

describeIntegration('custom domains over HTTP', () => {
  let server: TestServer;
  let owner: TestUser;
  let workspaceId: string;
  const saved = { capabilities: { ...env.capabilities }, domains: env.domains };
  let txt: Record<string, string[][]> = {};
  let cname: Record<string, string[]> = {};
  const provisioned: string[] = [];
  const removed: string[] = [];
  const provisioner: DomainProvisioner = {
    name: 'caddy',
    add: async (host) => void provisioned.push(host),
    remove: async (host) => void removed.push(host),
  };

  const api = async <T = any>(method: string, path: string, user: TestUser | null = owner, body?: unknown) => {
    const res = await server.request(path, { method, headers: user ? user.headers : {}, body });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body<T> };
  };
  const domains = (path = '') => `/api/workspaces/${workspaceId}/domains${path}`;

  const workspaceFor = async (user: TestUser, plan: PlanId) => {
    const workspace = await WorkspaceModel.create({ name: 'Acme', slug: `acme-${Date.now()}-${Math.random()}`, type: 'team', ownerId: user.id, plan });
    await WorkspaceMemberModel.create({ workspaceId: workspace._id, userId: user.id, role: 'owner' });
    return String(workspace._id);
  };

  /** Publishes the records the settings page shows for a domain. */
  const publish = (view: { hostname: string; records: { type: string; host: string; value: string }[] }) => {
    for (const record of view.records) {
      if (record.type === 'TXT') txt[record.host] = [[record.value]];
      else cname[record.host] = [`${record.value}.`];
    }
  };

  beforeAll(async () => {
    env.capabilities.customDomains = true;
    env.domains = { provisioner: 'caddy', cnameTarget: 'cname.openpoll.test', vercel: null };
    setDomainProvisioner(provisioner);
    setDomainDns({
      txt: async (host) => {
        if (!txt[host]) throw Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' });
        return txt[host]!;
      },
      cname: async (host) => {
        if (!cname[host]) throw Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' });
        return cname[host]!;
      },
    });
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    txt = {};
    cname = {};
    provisioned.length = 0;
    removed.length = 0;
    owner = await createVerifiedUser({ name: 'Olivia Owner' });
    workspaceId = await workspaceFor(owner, 'enterprise');
  });

  afterAll(async () => {
    Object.assign(env.capabilities, saved.capabilities);
    env.domains = saved.domains;
    setDomainProvisioner(null);
    setDomainDns(null);
    await resetTestData();
    await server?.close();
  });

  it('needs the server feature, the plan and an admin', async () => {
    env.capabilities.customDomains = false;
    expect((await api('GET', domains())).body.code).toBe('DOMAINS_DISABLED');
    env.capabilities.customDomains = true;

    await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'team' } });
    expect((await api('GET', domains())).body.code).toBe('FEATURE_NOT_IN_PLAN');
    await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'enterprise' } });

    const editor = await createVerifiedUser();
    await WorkspaceMemberModel.create({ workspaceId, userId: editor.id, role: 'editor' });
    expect((await api('GET', domains(), editor)).status).toBe(403);
    expect((await api('GET', domains())).body.data).toEqual({ cnameTarget: 'cname.openpoll.test', domains: [] });
  });

  it('adds a hostname, refuses ours and one already taken', async () => {
    expect((await api('POST', domains(), owner, { hostname: 'not a host' })).body.code).toBe('DOMAIN_INVALID');
    expect((await api('POST', domains(), owner, { hostname: 'x.cname.openpoll.test' })).body.code).toBe('DOMAIN_RESERVED');
    const added = await api('POST', domains(), owner, { hostname: 'Polls.Acme.test' });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({
      hostname: 'polls.acme.test',
      status: 'pending',
      records: [
        { type: 'CNAME', host: 'polls.acme.test', value: 'cname.openpoll.test', found: false },
        { type: 'TXT', host: '_openpoll.polls.acme.test', found: false },
      ],
    });
    const rival = await createVerifiedUser();
    const rivalWorkspace = await workspaceFor(rival, 'enterprise');
    const taken = await api('POST', `/api/workspaces/${rivalWorkspace}/domains`, rival, { hostname: 'polls.acme.test' });
    expect([taken.status, taken.body.code]).toEqual([409, 'DOMAIN_TAKEN']);
    expect((await api('POST', `/api/workspaces/${rivalWorkspace}/domains/${added.body.data.id}/verify`, rival)).status).toBe(404);
  });

  it('serves a domain once both records are there, then stops when it is removed', async () => {
    const added = (await api('POST', domains(), owner, { hostname: 'polls.acme.test' })).body.data;
    const early = await api('POST', domains(`/${added.id}/verify`));
    expect(early.body.data).toMatchObject({ status: 'pending', error: 'No TXT record at _openpoll.polls.acme.test yet' });
    expect((await api('GET', '/api/public/domains/resolve?host=polls.acme.test', null)).status).toBe(404);

    publish(added);
    const verified = await api('POST', domains(`/${added.id}/verify`));
    expect(verified.body.data).toMatchObject({ status: 'active', error: null, records: [{ found: true }, { found: true }] });
    expect(provisioned).toEqual(['polls.acme.test']);
    expect(await redisClient.sIsMember(ACTIVE_DOMAINS_KEY, 'polls.acme.test')).toBeTruthy();

    const resolved = await api('GET', '/api/public/domains/resolve?host=Polls.Acme.test:443', null);
    expect(resolved.body.data).toEqual({ hostname: 'polls.acme.test', workspace: { id: workspaceId, name: 'Acme' }, whiteLabel: true, theme: null });
    expect((await server.request('/api/public/domains/tls-ask?domain=polls.acme.test')).status).toBe(200);
    expect((await server.request('/api/public/domains/tls-ask?domain=evil.test')).status).toBe(404);

    // The browser API accepts the custom domain as an origin, and nothing else new.
    const preflight = (origin: string) =>
      server.request('/api/auth/me', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET' } });
    expect((await preflight('https://polls.acme.test')).headers.get('access-control-allow-origin')).toBe('https://polls.acme.test');
    expect((await preflight('https://evil.test')).headers.get('access-control-allow-origin')).toBeNull();

    expect((await api('DELETE', domains(`/${added.id}`))).status).toBe(200);
    expect(removed).toEqual(['polls.acme.test']);
    expect(await redisClient.sIsMember(ACTIVE_DOMAINS_KEY, 'polls.acme.test')).toBeFalsy();
    expect((await api('GET', '/api/public/domains/resolve?host=polls.acme.test', null)).status).toBe(404);
    expect((await server.request('/api/public/domains/tls-ask?domain=polls.acme.test')).status).toBe(404);
  });

  it('stops serving when the plan loses custom domains', async () => {
    const added = (await api('POST', domains(), owner, { hostname: 'polls.acme.test' })).body.data;
    publish(added);
    await api('POST', domains(`/${added.id}/verify`));
    await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'team' } });
    expect((await api('GET', '/api/public/domains/resolve?host=polls.acme.test', null)).status).toBe(404);
  });
});
