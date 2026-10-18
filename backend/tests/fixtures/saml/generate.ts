/**
 * Regenerates the SAML fixtures in this directory:
 *
 *   cd backend && bun tests/fixtures/saml/generate.ts
 *
 * - idp-cert.pem: a self-signed certificate (via the openssl CLI) standing
 *   in for an IdP signing cert.
 * - response.xml: a SAML 2.0 Response for the fixture SP whose Assertion and
 *   Response are both signed (RSA-SHA256, exclusive C14N), valid until 2099.
 *
 * The private key lives only in a temp directory for the run and is never
 * committed; regenerating replaces the certificate and the response together.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignedXml } from 'xml-crypto';
import { SAML_FIXTURE } from './constants';

const dir = import.meta.dir;
const work = mkdtempSync(join(tmpdir(), 'openpoll-saml-'));
let privateKey: Buffer;
let publicCert: Buffer;

try {
  const openssl = Bun.spawnSync([
    'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '36500',
    '-subj', '/CN=idp.openpoll.test',
    '-keyout', join(work, 'key.pem'),
    '-out', join(work, 'cert.pem'),
  ]);
  if (openssl.exitCode !== 0) throw new Error(`openssl failed: ${openssl.stderr.toString()}`);
  privateKey = readFileSync(join(work, 'key.pem'));
  publicCert = readFileSync(join(work, 'cert.pem'));
} finally {
  rmSync(work, { recursive: true, force: true });
}

const f = SAML_FIXTURE;

const unsigned = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response-openpoll-fixture" Version="2.0" IssueInstant="${f.issueInstant}" Destination="${f.acsUrl}">
  <saml:Issuer>${f.idpEntityId}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ID="_assertion-openpoll-fixture" Version="2.0" IssueInstant="${f.issueInstant}">
    <saml:Issuer>${f.idpEntityId}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${f.nameId}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${f.notOnOrAfter}" Recipient="${f.acsUrl}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${f.notBefore}" NotOnOrAfter="${f.notOnOrAfter}">
      <saml:AudienceRestriction><saml:Audience>${f.spEntityId}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${f.issueInstant}" SessionIndex="_session-openpoll-fixture">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email"><saml:AttributeValue xsi:type="xs:string">${f.nameId}</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="displayName"><saml:AttributeValue xsi:type="xs:string">${f.displayName}</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="groups">${f.groups.map((g) => `<saml:AttributeValue xsi:type="xs:string">${g}</saml:AttributeValue>`).join('')}</saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

const sign = (xml: string, element: 'Assertion' | 'Response') => {
  const signer = new SignedXml({
    privateKey,
    publicCert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  const target = element === 'Assertion' ? "//*[local-name(.)='Assertion']" : "/*[local-name(.)='Response']";
  signer.addReference({
    xpath: target,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  // The schema puts ds:Signature right after the element's own Issuer.
  signer.computeSignature(xml, {
    prefix: 'ds',
    location: { reference: `${target}/*[local-name(.)='Issuer']`, action: 'after' },
  });
  return signer.getSignedXml();
};

writeFileSync(join(dir, 'idp-cert.pem'), publicCert);
writeFileSync(join(dir, 'response.xml'), `${sign(sign(unsigned, 'Assertion'), 'Response')}\n`);
console.log(`Wrote idp-cert.pem and response.xml to ${dir}`);
