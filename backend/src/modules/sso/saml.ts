import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { XMLParser } from 'fast-xml-parser';
import { redisClient } from '../../common/config/redis';
import type { ISamlSettings, ISsoConnection } from './ssoConnection.model';
import { ssoUrls } from './sso.urls';

/** How long an AuthnRequest id stays valid for InResponseTo (the IdP round trip). */
const REQUEST_TTL_SEC = 10 * 60;
/** An assertion id is remembered at least this long, so a replay within its validity window fails. */
const REPLAY_TTL_SEC = 24 * 60 * 60;

/** node-saml's request cache in Redis, so any instance can finish a sign-in another started. */
const redisCache = (connectionId: string): CacheProvider => {
  const key = (id: string) => `sso:saml:req:${connectionId}:${id}`;
  return {
    async saveAsync(id, value) {
      await redisClient.set(key(id), value, { EX: REQUEST_TTL_SEC });
      return { value, createdAt: Date.now() };
    },
    async getAsync(id) {
      return redisClient.get(key(id));
    },
    async removeAsync(id) {
      if (!id) return null;
      const value = await redisClient.get(key(id));
      await redisClient.del(key(id));
      return value;
    },
  };
};

const pemBody = (cert: string) =>
  cert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

/** The SP for one connection: our entity id and ACS, the IdP's certificates; signed assertions required. */
export function samlFor(connection: Pick<ISsoConnection, '_id' | 'saml'>): SAML {
  const settings = connection.saml;
  if (!settings) throw new Error('Not a SAML connection');
  const urls = ssoUrls(String(connection._id));
  return new SAML({
    callbackUrl: urls.acsUrl,
    issuer: urls.spEntityId,
    audience: urls.spEntityId,
    entryPoint: settings.idpSsoUrl,
    idpIssuer: settings.idpEntityId,
    idpCert: settings.idpCerts.map(pemBody),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    requestIdExpirationPeriodMs: REQUEST_TTL_SEC * 1000,
    cacheProvider: redisCache(String(connection._id)),
    acceptedClockSkewMs: 2 * 60 * 1000,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    disableRequestedAuthnContext: true,
  });
}

export interface SamlIdentity {
  subject: string;
  email: string;
  name: string;
  groups: string[];
}

const firstString = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === 'string') ?? null;
  return null;
};

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );

/** The person a validated SAML profile describes, read through the connection's attribute names. */
export function identityFromProfile(profile: Profile, mapping: ISamlSettings['attributeMapping']): SamlIdentity {
  const email =
    firstString(profile[mapping.email]) ??
    firstString(profile.email) ??
    firstString(profile.mail) ??
    (profile.nameID?.includes('@') ? profile.nameID : null);
  if (!email) throw new Error('The identity provider sent no email address');
  const name = firstString(profile[mapping.name]) ?? email.split('@')[0]!;
  return { subject: profile.nameID, email: email.trim().toLowerCase(), name: name.trim(), groups: strings(profile[mapping.groups]) };
}

/**
 * Rejects a second use of the same assertion (IdP-initiated responses carry
 * no InResponseTo, so the request cache alone does not stop a replay).
 */
export async function claimAssertion(connectionId: string, profile: Profile): Promise<boolean> {
  const xml = profile.getAssertionXml?.() ?? '';
  const id = /\bID="([^"]+)"/.exec(xml)?.[1] ?? profile.ID ?? null;
  if (!id) return true;
  const claimed = await redisClient.set(`sso:saml:seen:${connectionId}:${id}`, '1', {
    condition: 'NX',
    expiration: { type: 'EX', value: REPLAY_TTL_SEC },
  });
  return claimed === 'OK';
}

/** What an IdP's metadata XML says about signing in (entity id, redirect or POST SSO URL, signing certificates). */
export function parseIdpMetadata(xml: string): Pick<ISamlSettings, 'idpEntityId' | 'idpSsoUrl' | 'idpCerts'> {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, attributeNamePrefix: '@_' });
  const doc = parser.parse(xml) as Record<string, any>;
  const descriptor = doc.EntityDescriptor ?? (Array.isArray(doc.EntitiesDescriptor?.EntityDescriptor) ? doc.EntitiesDescriptor.EntityDescriptor[0] : doc.EntitiesDescriptor?.EntityDescriptor);
  const idp = descriptor?.IDPSSODescriptor;
  if (!descriptor || !idp) throw new Error('This is not SAML identity provider metadata');
  const list = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
  const services = list<Record<string, string>>(idp.SingleSignOnService);
  const redirect = services.find((s) => s['@_Binding']?.endsWith('HTTP-Redirect')) ?? services.find((s) => s['@_Binding']?.endsWith('HTTP-POST'));
  const certs = list<Record<string, any>>(idp.KeyDescriptor)
    .filter((key) => !key['@_use'] || key['@_use'] === 'signing')
    .map((key) => key.KeyInfo?.X509Data?.X509Certificate)
    .flatMap((cert) => list(cert))
    .map((cert) => (typeof cert === 'string' ? cert : cert?.['#text']))
    .filter((cert): cert is string => typeof cert === 'string' && cert.trim() !== '')
    .map((cert) => cert.replace(/\s+/g, ''));
  const idpEntityId = descriptor['@_entityID'];
  if (!idpEntityId || !redirect?.['@_Location'] || certs.length === 0) {
    throw new Error('The metadata needs an entity id, a sign-in URL and a signing certificate');
  }
  return { idpEntityId, idpSsoUrl: redirect['@_Location'], idpCerts: [...new Set(certs)] };
}
