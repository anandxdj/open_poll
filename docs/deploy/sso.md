# Single sign-on and SCIM: operator setup

Workspace single sign-on (SAML 2.0 or OpenID Connect) and SCIM provisioning are for team
workspaces on the Enterprise plan. This page is for whoever runs the server; workspace admins
set up their connection under Settings, Single sign-on.

## Server settings

| Variable | Why |
| --- | --- |
| `ENCRYPTION_KEY` | Turns SSO and SCIM on. 32 bytes (`openssl rand -hex 32`). OIDC client secrets are stored encrypted with it: keep it stable and backed up. |
| `API_PUBLIC_URL` | The API's public origin, e.g. `https://api.openpoll.example`. Every URL an IdP registers (entity ID, ACS, metadata, OIDC redirect, sign-in) is built from it. Set it before the first connection and do not change it. |
| `FRONTEND_URL` | Where people land after signing in. |

Give a workspace Enterprise with `bun scripts/set-plan.ts <workspace-slug> enterprise` (or a Stripe
subscription with a plan override).

## What a workspace admin does

1. Settings, Single sign-on: add a SAML or OIDC connection.
2. Copy the values under "In your identity provider" into the IdP (SAML: entity ID, ACS URL, or the
   metadata URL; OIDC: the redirect URI). Send the email (NameID or an `email` attribute, verified for
   OIDC) and, to map roles, the groups.
3. SAML: paste the IdP metadata XML (or its entity ID, sign-in URL and signing certificate).
   OIDC: issuer URL, client ID and secret.
4. Add the company's email domains and publish each TXT record (`_openpoll.<domain>`), then Verify.
5. Turn the connection on, run "Test sign-in", and optionally "Require single sign-on" (the
   workspace owner keeps password sign-in as a way back in).
6. Settings, SCIM provisioning: create a token and give the IdP the base URL and the token.

Sign-in starts from Open Poll (the "Continue with SSO" button or the connection's sign-in URL).
IdP-initiated logins are refused; point IdP app tiles at the sign-in URL.

## Trying it locally with Keycloak

```bash
docker run -d --name openpoll-keycloak -p 127.0.0.1:8081:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.0 start-dev
```

1. Backend `.env`: `ENCRYPTION_KEY=<64 hex>`, `API_PUBLIC_URL=http://localhost:5000`.
2. Keycloak admin (http://localhost:8081): create a realm `openpoll`, a user with an email in a domain
   you control in DNS (or verify the domain by hand in Mongo for a local try:
   `db.ssoconnections.updateOne({'domains.domain':'example.com'},{$set:{'domains.$.verifiedAt':new Date()}})`).
3. SAML: Clients, Import client, paste the connection's metadata URL; under the client's Keys turn
   off "Client signature required"; add a mapper "User Property: email" named `email`. Copy
   `http://localhost:8081/realms/openpoll/protocol/saml/descriptor` into the connection's metadata.
4. OIDC: create an OpenID Connect client with client authentication on, the connection's redirect URI
   as a valid redirect URI, and use issuer `http://localhost:8081/realms/openpoll`.
5. Turn the connection on and use "Continue with SSO" on the login page with that user's email.
