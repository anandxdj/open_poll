import { z } from 'zod';
import { SSO_ROLES, SSO_TYPES } from './ssoConnection.model';

const pem = z.string().trim().min(64, 'Paste the whole certificate').max(20_000);

const samlSettings = z.strictObject({
  idpEntityId: z.string().trim().min(1).max(1024),
  idpSsoUrl: z.url({ protocol: /^https?$/, error: 'Use the IdP sign-in URL' }).max(2048),
  idpCerts: z.array(pem).min(1, 'Add the IdP signing certificate').max(4),
  attributeMapping: z
    .strictObject({
      email: z.string().trim().min(1).max(256),
      name: z.string().trim().min(1).max(256),
      groups: z.string().trim().min(1).max(256),
    })
    .partial()
    .optional(),
});

const oidcSettings = z.strictObject({
  issuer: z.url({ protocol: /^https?$/, error: 'Use the issuer URL' }).max(2048),
  clientId: z.string().trim().min(1).max(512),
  /** Write-only; omitted on update keeps the stored secret. */
  clientSecret: z.string().min(1).max(4096).optional(),
});

const groupRoles = z
  .array(z.strictObject({ group: z.string().trim().min(1).max(256), role: z.enum(SSO_ROLES) }))
  .max(50);

/** `POST /api/workspaces/:id/sso/connections` */
export const createConnectionSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Name the connection').max(80),
    type: z.enum(SSO_TYPES),
    saml: samlSettings.optional(),
    oidc: oidcSettings.optional(),
    jit: z.boolean().optional(),
    defaultRole: z.enum(SSO_ROLES).optional(),
    groupRoles: groupRoles.optional(),
  })
  .refine((body) => body.type !== 'oidc' || body.oidc?.clientSecret, {
    message: 'Add the client secret',
    path: ['oidc', 'clientSecret'],
  });

/** `PATCH .../connections/:id`: settings of the connection's own type; `enabled` turns sign-in on or off. */
export const updateConnectionSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    /** Fields left out keep their value (e.g. only `attributeMapping`). */
    saml: samlSettings.partial(),
    oidc: oidcSettings,
    jit: z.boolean(),
    defaultRole: z.enum(SSO_ROLES),
    groupRoles,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

export const metadataSchema = z.strictObject({ xml: z.string().min(50, 'Paste the metadata XML').max(500_000) });
export const domainSchema = z.strictObject({ domain: z.string().trim().min(3).max(253) });

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
