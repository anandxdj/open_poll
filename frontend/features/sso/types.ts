/** API shapes of `/api/workspaces/:id/sso`, `/api/workspaces/:id/scim` and `/api/sso/discover` (backend `modules/sso`, `modules/scim`). */

export type SsoRole = "admin" | "editor" | "presenter" | "viewer";
export const SSO_ROLES: SsoRole[] = ["admin", "editor", "presenter", "viewer"];

export interface SsoDomain {
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  /** The TXT record that proves the domain. */
  record: { host: string; value: string };
}

export interface SsoConnection {
  id: string;
  name: string;
  type: "saml" | "oidc";
  enabled: boolean;
  domains: SsoDomain[];
  saml: {
    idpEntityId: string;
    idpSsoUrl: string;
    wantAssertionsSigned: boolean;
    attributeMapping: { email: string; name: string; groups: string };
    certificates: number;
  } | null;
  oidc: { issuer: string; clientId: string; clientSecretSet: boolean } | null;
  jit: boolean;
  defaultRole: SsoRole;
  groupRoles: { group: string; role: SsoRole }[];
  lastTest: { at: string; email: string; name: string; groups: string[] } | null;
  lastLoginAt: string | null;
  serviceProvider: { entityId: string; acsUrl: string; metadataUrl: string; oidcRedirectUri: string; loginUrl: string };
  /** What still stops it from being turned on. */
  missing: string[];
}

export interface SsoOverview {
  connections: SsoConnection[];
  requireSso: boolean;
}

export interface ScimToken {
  id: string;
  label: string;
  prefix: string;
  last4: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface SsoDiscovery {
  connectionId: string;
  name: string;
  type: "saml" | "oidc";
  loginUrl: string;
}
