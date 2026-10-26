/**
 * A throwaway SAML identity provider for the SSO integration tests: a fresh
 * RSA key and certificate per run (openssl CLI), IdP metadata, and signed
 * responses to the AuthnRequest the app redirected to (the same signing as
 * tests/fixtures/saml/generate.ts, with live timestamps and InResponseTo).
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';

export const IDP_ENTITY_ID = 'https://idp.example.test/metadata';
export const IDP_SSO_URL = 'https://idp.example.test/sso';

const work = mkdtempSync(join(tmpdir(), 'openpoll-idp-'));
let privateKey: Buffer;
let publicCert: string;
try {
  const openssl = Bun.spawnSync([
    'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-subj', '/CN=idp.example.test',
    '-keyout', join(work, 'key.pem'),
    '-out', join(work, 'cert.pem'),
  ]);
  if (openssl.exitCode !== 0) throw new Error(`openssl failed: ${openssl.stderr.toString()}`);
  privateKey = readFileSync(join(work, 'key.pem'));
  publicCert = readFileSync(join(work, 'cert.pem'), 'utf8');
} finally {
  rmSync(work, { recursive: true, force: true });
}

export const idpCertPem = publicCert;
const certBody = publicCert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

export const idpMetadataXml = () => `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${IDP_ENTITY_ID}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${certBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${IDP_SSO_URL}/post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${IDP_SSO_URL}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

/** The AuthnRequest id and RelayState from the app's redirect to the IdP. */
export function readAuthnRequest(location: string) {
  const url = new URL(location);
  const xml = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64')).toString('utf8');
  const id = /\bID="([^"]+)"/.exec(xml)?.[1];
  if (!id) throw new Error('No AuthnRequest id');
  return { id, relayState: url.searchParams.get('RelayState') ?? '', url, xml };
}

export interface ResponseOptions {
  inResponseTo?: string;
  audience: string;
  acsUrl: string;
  nameId: string;
  email?: string;
  displayName?: string;
  groups?: string[];
  /** Minutes the assertion stays valid (negative: already expired). */
  validMinutes?: number;
}

/** A Response with a signed Assertion, base64 as the browser posts it. */
export function signedResponse(o: ResponseOptions): string {
  const now = new Date();
  const iso = (offsetMin: number) => new Date(now.getTime() + offsetMin * 60_000).toISOString();
  const until = iso(o.validMinutes ?? 5);
  const inResponseTo = o.inResponseTo ? ` InResponseTo="${o.inResponseTo}"` : '';
  const attribute = (name: string, values: string[]) =>
    values.length
      ? `<saml:Attribute Name="${name}">${values.map((v) => `<saml:AttributeValue xsi:type="xs:string">${v}</saml:AttributeValue>`).join('')}</saml:Attribute>`
      : '';
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID()}" Version="2.0" IssueInstant="${iso(0)}" Destination="${o.acsUrl}"${inResponseTo}>
  <saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ID="_a${randomUUID()}" Version="2.0" IssueInstant="${iso(0)}">
    <saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.nameId}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${until}" Recipient="${o.acsUrl}"${inResponseTo}/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${iso(-1)}" NotOnOrAfter="${until}">
      <saml:AudienceRestriction><saml:Audience>${o.audience}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="_s${randomUUID()}">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      ${attribute('email', [o.email ?? o.nameId])}
      ${attribute('displayName', o.displayName ? [o.displayName] : [])}
      ${attribute('groups', o.groups ?? [])}
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;
  const signer = new SignedXml({
    privateKey,
    publicCert: Buffer.from(publicCert),
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  const target = "//*[local-name(.)='Assertion']";
  signer.addReference({
    xpath: target,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  signer.computeSignature(xml, { prefix: 'ds', location: { reference: `${target}/*[local-name(.)='Issuer']`, action: 'after' } });
  return Buffer.from(signer.getSignedXml()).toString('base64');
}
