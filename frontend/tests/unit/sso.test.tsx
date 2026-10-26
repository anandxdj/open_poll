import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectionCard } from "@/features/sso/components/ConnectionCard";
import { ssoLoginUrl } from "@/features/sso/components/SsoDiscovery";
import type { SsoConnection } from "@/features/sso/types";

const connection = (over: Partial<SsoConnection> = {}): SsoConnection => ({
  id: "c1",
  name: "Okta",
  type: "saml",
  enabled: false,
  domains: [{ domain: "example.com", verified: false, verifiedAt: null, record: { host: "_openpoll.example.com", value: "openpoll-verify=abc" } }],
  saml: null,
  oidc: null,
  jit: true,
  defaultRole: "editor",
  groupRoles: [],
  lastTest: null,
  lastLoginAt: null,
  serviceProvider: {
    entityId: "https://api.example/api/sso/saml/c1/metadata",
    acsUrl: "https://api.example/api/sso/saml/c1/acs",
    metadataUrl: "https://api.example/api/sso/saml/c1/metadata",
    oidcRedirectUri: "https://api.example/api/sso/oidc/c1/callback",
    loginUrl: "https://api.example/api/sso/c1/login",
  },
  missing: ["identity provider details", "a verified domain"],
  ...over,
});

const html = (c: SsoConnection) => renderToStaticMarkup(<ConnectionCard workspaceId="w1" connection={c} onChange={() => {}} onRemoved={() => {}} />);

describe("single sign-on settings", () => {
  test("a SAML connection shows the values for the IdP, what is missing and the DNS record to add", () => {
    const markup = html(connection());
    expect(markup).toContain("https://api.example/api/sso/saml/c1/acs");
    expect(markup).toContain("Add identity provider details and a verified domain to turn it on.");
    expect(markup).toContain("_openpoll.example.com");
    expect(markup).toContain("openpoll-verify=abc");
    expect(markup).toContain("Waiting for DNS");
  });

  test("an OIDC connection shows its redirect URI and never a secret", () => {
    const markup = html(connection({ type: "oidc", oidc: { issuer: "https://login.example", clientId: "client-1", clientSecretSet: true } }));
    expect(markup).toContain("https://api.example/api/sso/oidc/c1/callback");
    expect(markup).toContain("Stored; type to replace");
    expect(markup).not.toContain("acs");
  });

  test("the discovered sign-in carries the email as a hint", () => {
    expect(ssoLoginUrl("https://api.example/api/sso/c1/login", "ada+x@example.com")).toBe(
      "https://api.example/api/sso/c1/login?email=ada%2Bx%40example.com",
    );
  });
});
