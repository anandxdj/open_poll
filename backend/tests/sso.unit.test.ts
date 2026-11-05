import { describe, expect, it } from 'bun:test';
import * as oidc from 'openid-client';
import { Types } from 'mongoose';
import { hasVerificationRecord, normalizeDomain, verificationHost, verificationValue } from '../src/common/utils/dnsVerify';
import { parseScimFilter, scimPage } from '../src/modules/scim/scim.filter';
import { setOidcDiscovery, startOidcLogin } from '../src/modules/sso/oidc';
import { identityFromProfile, parseIdpMetadata } from '../src/modules/sso/saml';
import { roleForGroups } from '../src/modules/sso/sso.login';
import { idpMetadataXml } from './integration/samlIdp';

describe('domain verification', () => {
  it('normalizes domains and rejects anything else', () => {
    expect(normalizeDomain(' Example.COM. ')).toBe('example.com');
    expect(normalizeDomain('sub.example.co.uk')).toBe('sub.example.co.uk');
    for (const bad of ['localhost', 'example', 'http://example.com', 'ex ample.com', '-x.com']) expect(normalizeDomain(bad)).toBeNull();
  });

  it('finds the TXT record, joined from chunks, and treats lookup errors as not yet', async () => {
    expect(verificationHost('example.com')).toBe('_openpoll.example.com');
    const value = verificationValue('abc');
    expect(await hasVerificationRecord('example.com', 'abc', async () => [['v=spf1'], ['openpoll-verify=', 'abc']])).toBe(true);
    expect(await hasVerificationRecord('example.com', 'abc', async () => [[`${value}x`]])).toBe(false);
    expect(await hasVerificationRecord('example.com', 'abc', async () => { throw new Error('ENOTFOUND'); })).toBe(false);
  });
});

describe('SAML helpers', () => {
  it('reads entity id, redirect sign-in URL and signing certificates from IdP metadata', () => {
    const parsed = parseIdpMetadata(idpMetadataXml());
    expect(parsed.idpEntityId).toBe('https://idp.example.test/metadata');
    expect(parsed.idpSsoUrl).toBe('https://idp.example.test/sso');
    expect(parsed.idpCerts).toHaveLength(1);
    expect(() => parseIdpMetadata('<EntityDescriptor entityID="x"/>')).toThrow(/not SAML identity provider metadata/);
  });

  it('maps a profile through the attribute names, falling back to the NameID', () => {
    const mapping = { email: 'mail', name: 'cn', groups: 'memberOf' };
    expect(identityFromProfile({ issuer: 'i', nameID: 'U1', nameIDFormat: 'x', mail: 'Ada@Example.com', cn: 'Ada', memberOf: ['A', 'B'] }, mapping)).toEqual({
      subject: 'U1',
      email: 'ada@example.com',
      name: 'Ada',
      groups: ['A', 'B'],
    });
    expect(identityFromProfile({ issuer: 'i', nameID: 'bea@example.com', nameIDFormat: 'x' }, mapping)).toMatchObject({ email: 'bea@example.com', name: 'bea', groups: [] });
    expect(() => identityFromProfile({ issuer: 'i', nameID: 'U2', nameIDFormat: 'x' }, mapping)).toThrow(/no email/);
  });

  it('gives the first mapped group role, else the default', () => {
    const connection = { defaultRole: 'viewer' as const, groupRoles: [{ group: 'Admins', role: 'admin' as const }, { group: 'Staff', role: 'editor' as const }] };
    expect(roleForGroups(connection, ['staff', 'admins'])).toBe('admin');
    expect(roleForGroups(connection, ['Staff'])).toBe('editor');
    expect(roleForGroups(connection, [])).toBe('viewer');
  });
});

describe('per-workspace OIDC', () => {
  it('sends the person to the connection’s issuer with PKCE, state, nonce and our callback', async () => {
    setOidcDiscovery(async (issuer, clientId) =>
      new oidc.Configuration({ issuer: issuer.href, authorization_endpoint: `${issuer.origin}/authorize`, token_endpoint: `${issuer.origin}/token` }, clientId, 'secret'),
    );
    const { encryptSecret } = await import('../src/common/utils/crypto');
    const id = new Types.ObjectId();
    const key = Buffer.alloc(32, 9);
    const start = await (async () => {
      const { env } = await import('../src/common/config/env');
      const saved = env.encryptionKey;
      env.encryptionKey = key;
      try {
        return await startOidcLogin(
          { _id: id, updatedAt: new Date(0), oidc: { issuer: 'https://login.example.test', clientId: 'c1', clientSecretEnc: encryptSecret('s', `sso:${id}`, key) } },
          'ada@example.com',
        );
      } finally {
        env.encryptionKey = saved;
      }
    })();
    expect(start.url.origin + start.url.pathname).toBe('https://login.example.test/authorize');
    expect(start.url.searchParams.get('client_id')).toBe('c1');
    expect(start.url.searchParams.get('redirect_uri')).toEndWith(`/api/sso/oidc/${id}/callback`);
    expect(start.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.url.searchParams.get('state')).toBe(start.state);
    expect(start.url.searchParams.get('login_hint')).toBe('ada@example.com');
  });
});

describe('SCIM filters', () => {
  const allowed = ['userName', 'externalId', 'active', 'emails.value'] as const;
  it('parses eq comparisons joined by and', () => {
    expect(parseScimFilter('userName eq "a@b.c"', allowed)).toEqual([{ attribute: 'userName', value: 'a@b.c' }]);
    expect(parseScimFilter('externalId eq "x\\"y" and Active eq true', allowed)).toEqual([
      { attribute: 'externalId', value: 'x"y' },
      { attribute: 'active', value: true },
    ]);
    expect(parseScimFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "a"', allowed)).toEqual([{ attribute: 'userName', value: 'a' }]);
    expect(parseScimFilter(undefined, allowed)).toEqual([]);
  });

  it('refuses other operators and attributes', () => {
    expect(() => parseScimFilter('userName co "a"', allowed)).toThrow(/Unsupported filter/);
    expect(() => parseScimFilter('title eq "x"', allowed)).toThrow(/not supported/);
    expect(() => parseScimFilter('userName eq "a" or userName eq "b"', allowed)).toThrow();
  });

  it('pages from 1 with at most 200', () => {
    expect(scimPage({})).toEqual({ startIndex: 1, count: 100 });
    expect(scimPage({ startIndex: '0', count: '999' })).toEqual({ startIndex: 1, count: 200 });
    expect(scimPage({ startIndex: '11', count: '5' })).toEqual({ startIndex: 11, count: 5 });
  });
});
