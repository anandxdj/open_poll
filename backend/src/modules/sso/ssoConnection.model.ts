import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

export const SSO_TYPES = ['saml', 'oidc'] as const;
export type SsoType = (typeof SSO_TYPES)[number];

/** Roles single sign-on may give a new member (never owner). */
export const SSO_ROLES = ['admin', 'editor', 'presenter', 'viewer'] as const;
export type SsoRole = (typeof SSO_ROLES)[number];

/** Most connections one workspace keeps. */
export const MAX_SSO_CONNECTIONS = 5;

export interface ISsoDomain {
  domain: string;
  /** The TXT record value is `openpoll-verify=<token>` at `_openpoll.<domain>`. */
  token: string;
  verifiedAt: Date | null;
}

export interface ISamlSettings {
  idpEntityId: string;
  idpSsoUrl: string;
  /** PEM bodies or full PEMs; any of them may sign (certificate rollover). */
  idpCerts: string[];
  wantAssertionsSigned: boolean;
  /** Attribute names; email falls back to the NameID. */
  attributeMapping: { email: string; name: string; groups: string };
}

export interface IOidcSettings {
  issuer: string;
  clientId: string;
  /** encryptSecret(secret, `sso:<connection id>`). */
  clientSecretEnc: string;
}

/**
 * A workspace's single sign-on connection (W3-D): a SAML or OIDC identity
 * provider, the email domains it vouches for (each proven by DNS), and how
 * new people are let in (just in time, with a default role or one mapped from
 * their IdP groups).
 */
export interface ISsoConnection extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  type: SsoType;
  enabled: boolean;
  domains: Types.DocumentArray<ISsoDomain & Document>;
  saml: ISamlSettings | null;
  oidc: IOidcSettings | null;
  /** Create accounts and memberships on first sign-in. */
  jit: boolean;
  defaultRole: SsoRole;
  /** First matching IdP group wins. */
  groupRoles: { group: string; role: SsoRole }[];
  /** The last test sign-in an admin ran (no account was touched). */
  lastTest: { at: Date; email: string; name: string; groups: string[] } | null;
  lastLoginAt: Date | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const domainSchema = new Schema<ISsoDomain>(
  {
    domain: { type: String, required: true, lowercase: true, trim: true },
    token: { type: String, required: true },
    verifiedAt: { type: Date, default: null },
  },
  { _id: false },
);

const samlSchema = new Schema<ISamlSettings>(
  {
    idpEntityId: { type: String, required: true },
    idpSsoUrl: { type: String, required: true },
    idpCerts: { type: [String], default: [] },
    wantAssertionsSigned: { type: Boolean, default: true },
    attributeMapping: {
      email: { type: String, default: 'email' },
      name: { type: String, default: 'displayName' },
      groups: { type: String, default: 'groups' },
    },
  },
  { _id: false },
);

const oidcSchema = new Schema<IOidcSettings>(
  {
    issuer: { type: String, required: true },
    clientId: { type: String, required: true },
    clientSecretEnc: { type: String, required: true },
  },
  { _id: false },
);

const ssoConnectionSchema = new Schema<ISsoConnection>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: SSO_TYPES, required: true },
    enabled: { type: Boolean, default: false },
    domains: { type: [domainSchema], default: [] },
    saml: { type: samlSchema, default: null },
    oidc: { type: oidcSchema, default: null },
    jit: { type: Boolean, default: true },
    defaultRole: { type: String, enum: SSO_ROLES, default: 'editor' },
    groupRoles: {
      type: [new Schema({ group: { type: String, required: true }, role: { type: String, enum: SSO_ROLES, required: true } }, { _id: false })],
      default: [],
    },
    lastTest: {
      type: new Schema(
        { at: Date, email: String, name: String, groups: { type: [String], default: [] } },
        { _id: false },
      ),
      default: null,
    },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  // Production indexes come from migrations (bun run migrate), not boot.
  { timestamps: true, autoIndex: !env.isProduction },
);

ssoConnectionSchema.index({ workspaceId: 1 });
// Discovery by email domain; the service keeps a verified domain to one connection.
ssoConnectionSchema.index({ 'domains.domain': 1 });

export const SsoConnectionModel = mongoose.model<ISsoConnection>('SsoConnection', ssoConnectionSchema);
