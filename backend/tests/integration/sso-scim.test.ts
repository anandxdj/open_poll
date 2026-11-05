import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { env } from '../../src/common/config/env';
import type { PlanId } from '../../src/common/plans/plans';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { UserModel } from '../../src/modules/auth/auth.model';
import { setSsoTxtResolver } from '../../src/modules/sso/sso.admin.service';
import { SsoConnectionModel } from '../../src/modules/sso/ssoConnection.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceGroupModel } from '../../src/modules/workspaces/workspaceGroup.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';
import { idpMetadataXml, readAuthnRequest, signedResponse } from './samlIdp';

/** W3-D: workspace SAML single sign-on (settings, sign-in, JIT, require SSO) and SCIM 2.0 provisioning over HTTP. */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: any; data: T };

describeIntegration('single sign-on and SCIM over HTTP', () => {
  let server: TestServer;
  let owner: TestUser;
  let workspaceId: string;
  const saved = { capabilities: { ...env.capabilities }, key: env.encryptionKey };
  let txt: Record<string, string[][]> = {};

  const api = async <T = any>(method: string, path: string, user: TestUser | null = owner, body?: unknown) => {
    const res = await server.request(path, { method, headers: user ? user.headers : {}, body });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };
  const sso = (path = '') => `/api/workspaces/${workspaceId}/sso${path}`;

  /** A team workspace on Enterprise with `owner` as its owner. */
  const teamWorkspace = async (user: TestUser, plan: PlanId = 'enterprise') => {
    const workspace = await WorkspaceModel.create({ name: 'Acme', slug: `acme-${Date.now()}-${Math.random()}`, type: 'team', ownerId: user.id, plan });
    await WorkspaceMemberModel.create({ workspaceId: workspace._id, userId: user.id, role: 'owner' });
    return String(workspace._id);
  };

  /** A SAML connection from IdP metadata, with example.com verified and sign-in on. */
  const readyConnection = async (extra: Record<string, unknown> = {}) => {
    const created = await api('POST', sso('/connections'), owner, { name: 'Okta', type: 'saml', ...extra });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await api('POST', sso(`/connections/${id}/metadata`), owner, { xml: idpMetadataXml() })).status).toBe(200);
    const added = await api('POST', sso(`/connections/${id}/domains`), owner, { domain: 'Example.com' });
    const record = added.body.data.domains[0].record as { host: string; value: string };
    txt[record.host] = [[record.value]];
    expect((await api('POST', sso(`/connections/${id}/domains/example.com/verify`))).status).toBe(200);
    expect((await api('PATCH', sso(`/connections/${id}`), owner, { enabled: true })).status).toBe(200);
    return id;
  };

  const urlsOf = (id: string) => ({
    audience: `${env.apiPublicUrl}/api/sso/saml/${id}/metadata`,
    acsUrl: `${env.apiPublicUrl}/api/sso/saml/${id}/acs`,
  });

  /** Starts a sign-in, answers it as the IdP, returns the app's redirect. */
  const signIn = async (
    id: string,
    person: { email: string; displayName?: string; groups?: string[]; nameId?: string },
    loginPath = `/api/sso/${id}/login`,
  ) => {
    const start = await server.request(loginPath, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const request = readAuthnRequest(start.headers.get('location')!);
    expect(request.url.origin + request.url.pathname).toBe('https://idp.example.test/sso');
    const SAMLResponse = signedResponse({
      ...urlsOf(id),
      inResponseTo: request.id,
      nameId: person.nameId ?? person.email,
      email: person.email,
      displayName: person.displayName,
      groups: person.groups,
    });
    const post = (response: string) =>
      server.request(`/api/sso/saml/${id}/acs`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLResponse: response, RelayState: request.relayState }).toString(),
      });
    const answer = await post(SAMLResponse);
    return { location: answer.headers.get('location') ?? '', status: answer.status, replay: () => post(SAMLResponse) };
  };

  /** The access token behind a `/auth/complete?code=` redirect. */
  const exchange = async (location: string) => {
    const code = new URL(location).searchParams.get('code')!;
    const res = await api('POST', '/api/auth/oauth/exchange', null, { code });
    expect(res.status).toBe(200);
    return { authorization: `Bearer ${res.body.data.accessToken}` };
  };

  beforeAll(async () => {
    Object.assign(env.capabilities, { samlSso: true, scim: true });
    env.encryptionKey = Buffer.alloc(32, 7);
    setSsoTxtResolver(async (host) => {
      if (!txt[host]) throw Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' });
      return txt[host]!;
    });
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    txt = {};
    owner = await createVerifiedUser({ name: 'Olivia Owner', email: `olivia-${Date.now()}@example.com` });
    workspaceId = await teamWorkspace(owner);
  });

  afterAll(async () => {
    Object.assign(env.capabilities, saved.capabilities);
    env.encryptionKey = saved.key;
    setSsoTxtResolver(undefined);
    await resetTestData();
    await server?.close();
  });

  describe('settings', () => {
    it('needs the server feature, a team workspace, an admin and the plan', async () => {
      env.capabilities.samlSso = false;
      expect((await api('GET', sso())).body.code).toBe('SSO_DISABLED');
      env.capabilities.samlSso = true;

      await api('GET', '/api/presentations', owner);
      const personal = (await WorkspaceModel.findOne({ ownerId: owner.id, type: 'personal' }).lean())!;
      expect((await api('GET', `/api/workspaces/${personal._id}/sso`)).body.code).toBe('TEAM_WORKSPACE_ONLY');

      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'team' } });
      const res = await api('GET', sso());
      expect([res.status, res.body.code]).toEqual([403, 'FEATURE_NOT_IN_PLAN']);
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'enterprise' } });

      const editor = await createVerifiedUser();
      await WorkspaceMemberModel.create({ workspaceId, userId: editor.id, role: 'editor' });
      expect((await api('GET', sso(), editor)).status).toBe(403);
      expect((await api('GET', sso())).status).toBe(200);
    });

    it('sets a connection up from metadata and a DNS-verified domain before it can be turned on', async () => {
      const created = await api('POST', sso('/connections'), owner, { name: 'Okta', type: 'saml' });
      const id = created.body.data.id as string;
      expect(created.body.data.missing).toEqual(['identity provider details', 'a verified domain']);
      expect(created.body.data.serviceProvider.acsUrl).toBe(urlsOf(id).acsUrl);

      const notReady = await api('PATCH', sso(`/connections/${id}`), owner, { enabled: true });
      expect([notReady.status, notReady.body.code]).toEqual([400, 'SSO_NOT_READY']);

      const bad = await api('POST', sso(`/connections/${id}/metadata`), owner, { xml: `<x>${'a'.repeat(60)}</x>` });
      expect(bad.body.code).toBe('SSO_BAD_METADATA');
      const imported = await api('POST', sso(`/connections/${id}/metadata`), owner, { xml: idpMetadataXml() });
      expect(imported.body.data.saml).toMatchObject({ idpEntityId: 'https://idp.example.test/metadata', idpSsoUrl: 'https://idp.example.test/sso', certificates: 1 });

      const added = await api('POST', sso(`/connections/${id}/domains`), owner, { domain: 'example.com' });
      const record = added.body.data.domains[0].record;
      expect(record.host).toBe('_openpoll.example.com');
      const missing = await api('POST', sso(`/connections/${id}/domains/example.com/verify`));
      expect([missing.status, missing.body.code]).toEqual([400, 'SSO_DOMAIN_NOT_VERIFIED']);
      txt[record.host] = [[record.value]];
      const verified = await api('POST', sso(`/connections/${id}/domains/example.com/verify`));
      expect(verified.body.data.domains[0].verified).toBe(true);
      expect((await api('PATCH', sso(`/connections/${id}`), owner, { enabled: true })).body.data.enabled).toBe(true);

      // Nobody else can claim the domain afterwards.
      const rival = await createVerifiedUser();
      const rivalWorkspace = await teamWorkspace(rival);
      const theirs = await api('POST', `/api/workspaces/${rivalWorkspace}/sso/connections`, rival, { name: 'Theirs', type: 'saml' });
      const theirsId = theirs.body.data.id;
      const theirDomain = await api('POST', `/api/workspaces/${rivalWorkspace}/sso/connections/${theirsId}/domains`, rival, { domain: 'example.com' });
      txt[theirDomain.body.data.domains[0].record.host] = [[theirDomain.body.data.domains[0].record.value]];
      const taken = await api('POST', `/api/workspaces/${rivalWorkspace}/sso/connections/${theirsId}/domains/example.com/verify`, rival);
      expect([taken.status, taken.body.code]).toEqual([409, 'SSO_DOMAIN_TAKEN']);
      // Nor read or change ours.
      expect((await api('PATCH', `/api/workspaces/${rivalWorkspace}/sso/connections/${id}`, rival, { name: 'Mine' })).status).toBe(404);
    });

    it('stores an OIDC client secret encrypted and never returns it', async () => {
      const created = await api('POST', sso('/connections'), owner, {
        name: 'Entra',
        type: 'oidc',
        oidc: { issuer: 'https://login.example.test/v2.0', clientId: 'client-1', clientSecret: 'super-secret-value' },
      });
      expect(created.status).toBe(201);
      expect(created.body.data.oidc).toEqual({ issuer: 'https://login.example.test/v2.0', clientId: 'client-1', clientSecretSet: true });
      expect(JSON.stringify(created.body)).not.toContain('super-secret-value');
      const stored = await SsoConnectionModel.findById(created.body.data.id).lean();
      expect(stored!.oidc!.clientSecretEnc).toStartWith('v1.');
      expect(stored!.oidc!.clientSecretEnc).not.toContain('super-secret');
    });
  });

  describe('signing in', () => {
    it('finds the connection by email, creates the account just in time with the role its groups map to', async () => {
      const id = await readyConnection({ groupRoles: [{ group: 'Admins', role: 'admin' }], defaultRole: 'viewer' });
      const found = await api('GET', '/api/sso/discover?email=ada@EXAMPLE.com', null);
      expect(found.body.data).toMatchObject({ connectionId: id, name: 'Okta', type: 'saml' });
      expect((await api('GET', '/api/sso/discover?email=ada@other.test', null)).status).toBe(404);

      const { status, location } = await signIn(id, { email: 'ada@example.com', displayName: 'Ada Lovelace', groups: ['Engineering', 'Admins'] });
      expect(status).toBe(302);
      expect(location).toStartWith(`${env.FRONTEND_URL}/auth/complete?code=`);
      const me = await api('GET', '/api/auth/me', { headers: await exchange(location) } as unknown as TestUser);
      expect(me.body.data).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace', isVerified: true });
      const membership = await WorkspaceMemberModel.findOne({ workspaceId, userId: me.body.data._id }).lean();
      expect(membership).toMatchObject({ role: 'admin', status: 'active', source: 'sso_jit' });
      expect(await AuditEventModel.countDocuments({ action: 'sso.login' })).toBe(1);

      // Signing in again finds the same account by its SAML identity.
      const again = await signIn(id, { email: 'ada@example.com', groups: [] });
      expect(again.location).toStartWith(`${env.FRONTEND_URL}/auth/complete?code=`);
      expect(await UserModel.countDocuments({ email: 'ada@example.com' })).toBe(1);
    });

    it('refuses replays, other domains, unknown people without JIT and tampered responses', async () => {
      const id = await readyConnection();
      const first = await signIn(id, { email: 'bea@example.com' });
      expect(first.location).toContain('/auth/complete?code=');
      const replay = await first.replay();
      expect(replay.headers.get('location')).toBe(`${env.FRONTEND_URL}/login?error=sso_expired`);

      expect((await signIn(id, { email: 'mallory@evil.test' })).location).toBe(`${env.FRONTEND_URL}/login?error=sso_domain`);

      await api('PATCH', sso(`/connections/${id}`), owner, { jit: false });
      expect((await signIn(id, { email: 'new@example.com' })).location).toBe(`${env.FRONTEND_URL}/login?error=sso_no_account`);

      const start = await server.request(`/api/sso/${id}/login`, { redirect: 'manual' });
      const request = readAuthnRequest(start.headers.get('location')!);
      const forged = Buffer.from(
        Buffer.from(signedResponse({ ...urlsOf(id), inResponseTo: request.id, nameId: 'bea@example.com' }), 'base64')
          .toString('utf8')
          .replace('>bea@example.com</saml:NameID>', '>olivia@example.com</saml:NameID>'),
      ).toString('base64');
      const tampered = await server.request(`/api/sso/saml/${id}/acs`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLResponse: forged, RelayState: request.relayState }).toString(),
      });
      expect(tampered.headers.get('location')).toBe(`${env.FRONTEND_URL}/login?error=sso_failed`);
    });

    it('requires single sign-on only after a passed test, and keeps the owner able to sign in', async () => {
      const id = await readyConnection();
      const member = await createVerifiedUser({ email: 'carl@example.com' });
      await WorkspaceMemberModel.create({ workspaceId, userId: member.id, role: 'editor' });

      const early = await api('PATCH', `/api/workspaces/${workspaceId}`, owner, { settings: { requireSso: true } });
      expect([early.status, early.body.code]).toEqual([400, 'SSO_NOT_READY']);

      const test = await api('POST', sso(`/connections/${id}/test`));
      const testPath = new URL(test.body.data.url).pathname + new URL(test.body.data.url).search;
      const tested = await signIn(id, { email: 'olivia-test@example.com', groups: ['Admins'] }, testPath);
      expect(tested.location).toBe(`${env.FRONTEND_URL}/settings/sso?connection=${id}&test=success`);
      expect(await UserModel.exists({ email: 'olivia-test@example.com' })).toBeNull();
      expect((await api('GET', sso())).body.data.connections[0].lastTest).toMatchObject({ email: 'olivia-test@example.com', groups: ['Admins'] });

      expect((await api('PATCH', `/api/workspaces/${workspaceId}`, owner, { settings: { requireSso: true } })).status).toBe(200);
      const blocked = await api('POST', '/api/auth/login', null, { email: member.email, password: member.password });
      expect([blocked.status, blocked.body.code, blocked.body.details?.connectionId]).toEqual([403, 'SSO_REQUIRED', id]);
      const ownerLogin = await api('POST', '/api/auth/login', null, { email: owner.email, password: owner.password });
      expect(ownerLogin.status).toBe(200);

      // Turning the connection off lifts the requirement, so nobody is locked out.
      await api('PATCH', sso(`/connections/${id}`), owner, { enabled: false });
      expect((await WorkspaceModel.findById(workspaceId).lean())!.settings.requireSso).toBe(false);
      expect((await api('POST', '/api/auth/login', null, { email: member.email, password: member.password })).status).toBe(200);
    });
  });

  describe('SCIM', () => {
    let token = '';
    const scim = async (method: string, path: string, body?: unknown, bearer = token) => {
      const res = await server.request(`/scim/v2${path}`, {
        method,
        headers: { authorization: `Bearer ${bearer}`, ...(body ? { 'content-type': 'application/scim+json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, type: res.headers.get('content-type'), body: res.status === 204 ? null : ((await res.json()) as any) };
    };

    beforeEach(async () => {
      const created = await api('POST', `/api/workspaces/${workspaceId}/scim/tokens`, owner, { label: 'Okta' });
      expect(created.status).toBe(201);
      token = created.body.data.token;
      expect(token).toStartWith('scim_');
      expect((await api('GET', `/api/workspaces/${workspaceId}/scim/tokens`)).body.data.tokens[0]).not.toHaveProperty('token');
    });

    it('answers discovery and refuses bad tokens in SCIM format', async () => {
      const config = await scim('GET', '/ServiceProviderConfig');
      expect(config.status).toBe(200);
      expect(config.type).toContain('application/scim+json');
      expect(config.body.patch.supported).toBe(true);
      expect((await scim('GET', '/ResourceTypes')).body.totalResults).toBe(2);
      const denied = await scim('GET', '/Users', undefined, 'scim_wrong');
      expect(denied.status).toBe(401);
      expect(denied.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    });

    it('provisions, finds, deactivates, reactivates and removes a user', async () => {
      const created = await scim('POST', '/Users', {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'Dana@Example.com',
        name: { givenName: 'Dana', familyName: 'Scully' },
        emails: [{ value: 'dana@example.com', primary: true }],
        externalId: '00u1',
        active: true,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ userName: 'dana@example.com', displayName: 'Dana Scully', active: true, externalId: '00u1' });
      const id = created.body.id as string;
      expect((await scim('POST', '/Users', { userName: 'dana@example.com' })).body.scimType).toBe('uniqueness');

      const found = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "dana@example.com"')}`);
      expect(found.body).toMatchObject({ totalResults: 1, Resources: [{ id }] });
      expect((await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "00u1" and active eq true')}`)).body.totalResults).toBe(1);
      expect((await scim('GET', `/Users?filter=${encodeURIComponent('name.givenName sw "D"')}`)).body.scimType).toBe('invalidFilter');

      // Azure AD style: a value object without a path.
      const off = await scim('PATCH', `/Users/${id}`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'Replace', value: { active: false } }],
      });
      expect(off.body.active).toBe(false);
      expect((await WorkspaceMemberModel.findOne({ workspaceId, userId: id }).lean())!.status).toBe('suspended');
      expect((await UserModel.findById(id).lean())!.active).toBe(false);

      const on = await scim('PATCH', `/Users/${id}`, { Operations: [{ op: 'replace', path: 'active', value: true }] });
      expect(on.body.active).toBe(true);

      expect((await scim('DELETE', `/Users/${id}`)).status).toBe(204);
      expect(await WorkspaceMemberModel.exists({ workspaceId, userId: id })).toBeNull();
      expect((await scim('GET', `/Users/${id}`)).status).toBe(404);
      expect(await AuditEventModel.countDocuments({ actorType: 'scim' })).toBeGreaterThanOrEqual(4);
    });

    it('manages groups and their members', async () => {
      const dana = (await scim('POST', '/Users', { userName: 'dana@example.com' })).body.id as string;
      const fox = (await scim('POST', '/Users', { userName: 'fox@example.com' })).body.id as string;
      const group = await scim('POST', '/Groups', { displayName: 'Engineering', externalId: 'g1', members: [{ value: dana }, { value: 'not-an-id' }] });
      expect(group.status).toBe(201);
      expect(group.body.members.map((m: { value: string }) => m.value)).toEqual([dana]);
      const gid = group.body.id as string;

      await scim('PATCH', `/Groups/${gid}`, { Operations: [{ op: 'add', path: 'members', value: [{ value: fox }] }] });
      await scim('PATCH', `/Groups/${gid}`, { Operations: [{ op: 'remove', path: `members[value eq "${dana}"]` }] });
      const renamed = await scim('PATCH', `/Groups/${gid}`, { Operations: [{ op: 'replace', value: { displayName: 'Platform' } }] });
      expect(renamed.body).toMatchObject({ displayName: 'Platform', members: [{ value: fox }] });
      expect((await scim('GET', `/Groups?filter=${encodeURIComponent('displayName eq "Platform"')}`)).body.totalResults).toBe(1);
      expect((await WorkspaceGroupModel.findById(gid).lean())!.memberIds.map(String)).toEqual([fox]);
      expect((await scim('DELETE', `/Groups/${gid}`)).status).toBe(204);
    });

    it('keeps each workspace to its own people, and a revoked token stops working', async () => {
      const dana = (await scim('POST', '/Users', { userName: 'dana@example.com' })).body.id as string;
      const rival = await createVerifiedUser();
      const rivalWorkspace = await teamWorkspace(rival);
      const theirToken = (await api('POST', `/api/workspaces/${rivalWorkspace}/scim/tokens`, rival, { label: 'Theirs' })).body.data.token;
      expect((await scim('GET', `/Users/${dana}`, undefined, theirToken)).status).toBe(404);
      const theirs = (await scim('GET', '/Users', undefined, theirToken)).body;
      expect(theirs.Resources.map((u: { userName: string }) => u.userName)).toEqual([rival.email]);

      const list = (await api('GET', `/api/workspaces/${workspaceId}/scim/tokens`)).body.data.tokens;
      await api('DELETE', `/api/workspaces/${workspaceId}/scim/tokens/${list[0].id}`);
      expect((await scim('GET', '/Users')).status).toBe(401);
    });
  });
});
