import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { SAML } from '@node-saml/node-saml';
import { SAML_FIXTURE } from '../fixtures/saml/constants';

/** W3-D spike: @node-saml/node-saml validates a signed IdP response under Bun. */
const fixtures = `${import.meta.dir}/../fixtures/saml`;
const idpCert = readFileSync(`${fixtures}/idp-cert.pem`, 'utf8');
const response = readFileSync(`${fixtures}/response.xml`, 'utf8');

const sp = (overrides: Partial<ConstructorParameters<typeof SAML>[0]> = {}) =>
  new SAML({
    callbackUrl: SAML_FIXTURE.acsUrl,
    issuer: SAML_FIXTURE.spEntityId,
    audience: SAML_FIXTURE.spEntityId,
    idpIssuer: SAML_FIXTURE.idpEntityId,
    idpCert,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    ...overrides,
  });

const post = (xml: string) => ({ SAMLResponse: Buffer.from(xml).toString('base64') });

describe('spike: @node-saml/node-saml', () => {
  it('accepts the signed fixture response and maps the profile', async () => {
    const { profile, loggedOut } = await sp().validatePostResponseAsync(post(response));
    expect(loggedOut).toBe(false);
    expect(profile?.nameID).toBe(SAML_FIXTURE.nameId);
    expect(profile?.issuer).toBe(SAML_FIXTURE.idpEntityId);
    expect(profile?.displayName).toBe(SAML_FIXTURE.displayName);
    expect(profile?.groups).toEqual([...SAML_FIXTURE.groups]);
  });

  it('rejects a response whose signed content was altered', async () => {
    const tampered = response.replace(
      `>${SAML_FIXTURE.nameId}</saml:NameID>`,
      '>mallory@example.com</saml:NameID>',
    );
    expect(tampered).not.toBe(response);
    await expect(sp().validatePostResponseAsync(post(tampered))).rejects.toThrow(/signature/i);
  });

  it('rejects the response for another audience', async () => {
    await expect(
      sp({ audience: 'https://other.example.com/metadata' }).validatePostResponseAsync(post(response)),
    ).rejects.toThrow(/audience/i);
  });
});
