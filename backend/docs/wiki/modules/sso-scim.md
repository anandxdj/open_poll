---
summary: Workspace single sign-on (SAML 2.0 and OIDC per workspace, DNS-verified domains, JIT, group roles, require SSO) and SCIM 2.0 provisioning (W3-D).
status: active
last_updated: 2026-10-26
---

# Single sign-on and SCIM (`src/modules/sso/`, `src/modules/scim/`)

Team workspaces on Enterprise connect their identity provider. Server switch: `ENCRYPTION_KEY`
(capabilities `samlSso`, `scim`; OIDC client secrets are stored with `encryptSecret`). All URLs the
IdP registers come from `API_PUBLIC_URL` (`env.apiPublicUrl`, else `http://localhost:PORT`), never from
request headers; set it before any connection exists and keep it.

## Connections (`ssoConnection.model.ts`)

`SsoConnection {workspaceId, name, type: saml|oidc, enabled, domains[{domain, token, verifiedAt}],
saml {idpEntityId, idpSsoUrl, idpCerts[], wantAssertionsSigned, attributeMapping {email, name, groups}},
oidc {issuer, clientId, clientSecretEnc}, jit, defaultRole, groupRoles[{group, role}], lastTest, lastLoginAt}`,
up to 5 per workspace (migration 180).

- **Domains.** Proven by a TXT record `openpoll-verify=<token>` at `_openpoll.<domain>`
  (`common/utils/dnsVerify.ts`, also for W4-E). A verified domain belongs to one connection in the
  whole deployment (409 `SSO_DOMAIN_TAKEN`). An IdP can only sign in addresses in its verified domains.
- **On/off.** `enabled: true` needs IdP details and a verified domain (400 `SSO_NOT_READY` with
  `details.missing`). Turning the last enabled connection off, deleting it or removing its last
  verified domain turns `settings.requireSso` off, so nobody is locked out.
- **Test sign-in.** `POST .../connections/:id/test` returns a one-time `?test=` login link (10 min). The
  run checks the response and the domain, stores `lastTest {at, email, name, groups}` and returns to
  `/settings/sso?connection=<id>&test=success|domain`. No account or membership is touched.

## Settings API (`/api/workspaces/:workspaceId/sso`, pathWorkspaceContext)

Guards: capability `samlSso` (503 `SSO_DISABLED`), team workspace (403 `TEAM_WORKSPACE_ONLY`),
`workspace:sso`, plan `sso`. `GET /` (`{connections, requireSso}`), `POST /connections`
(`{name, type, saml?, oidc?, jit?, defaultRole?, groupRoles?}`; OIDC needs `clientSecret`), `PATCH`/`DELETE
/connections/:id` (SAML fields left out keep their value; a new client secret replaces the stored one),
`POST /connections/:id/metadata {xml}` (400 `SSO_BAD_METADATA`), domains add / verify (400
`SSO_DOMAIN_NOT_VERIFIED` with the record) / remove, `POST /connections/:id/test`. Views never include
secrets (`oidc.clientSecretSet`), and carry `serviceProvider {entityId, acsUrl, metadataUrl,
oidcRedirectUri, loginUrl}` and `missing[]`. Audit: `sso.connection_create|update|delete`,
`sso.domain_verify`, `sso.test`, `sso.login`.

`PATCH /api/workspaces/:id` `settings.requireSso` (`workspace:sso`, plan `sso`): turning it on needs an
enabled connection with a verified domain and a `lastTest` (400 `SSO_NOT_READY`).

## Signing in (`/api/sso/*`, no account; allow-listed)

| Route | What |
| --- | --- |
| `GET /discover?email` | `{connectionId, name, type, loginUrl}` for an email in a verified domain of an enabled connection, else 404 `SSO_NOT_FOUND`. |
| `GET /:id/login[?email][?test]` | SAML: an AuthnRequest (HTTP-Redirect) with a `RelayState` flow id in Redis. OIDC: PKCE, state and nonce in Redis, state bound to this browser by the `sso_state` cookie (path `/api/sso`). |
| `POST /saml/:id/acs` | Pre-parser mount (urlencoded, before CORS). node-saml validates the signed assertion, audience, recipient and times, and `InResponseTo` against the request ids it cached in Redis. The `RelayState` must name a flow this server started (one use, 10 min), so IdP-initiated responses are refused (IdP app tiles should point at the sign-in URL), and each assertion id is claimed once (`sso:saml:seen:*`, 24 h). |
| `GET /saml/:id/metadata` | SP metadata XML. |
| `GET /oidc/:id/callback` | Code exchange through openid-client (per-connection discovery, cached, dropped on failure). |

`completeSsoLogin` (`sso.login.ts`): domain check, user by this connection's identity
(`saml`/`oidc_ws` + `connectionId`), else by email (linking; an unverified local account is reset
first), else just in time when `jit`. Members must be `active` (suspended: `sso_suspended`). A new
member gets the first matching `groupRoles` role or `defaultRole` (never owner), within the plan's
seats (`sso_seats`), `source: 'sso_jit'`, and the workspace becomes their default. Then
`startSession` and the usual exchange-code redirect to `/auth/complete`. Failures redirect to
`/login?error=<code>`: `sso_failed`, `sso_expired`, `sso_domain`, `sso_no_account`, `sso_suspended`,
`sso_seats`, `sso_disabled`.

**Require SSO** (`requireSso.ts`): password, Google and global-OIDC sign-ins for an email in a verified
domain of a workspace with `requireSso` get 403 `SSO_REQUIRED` (`details.connectionId`; redirect flows:
`/login?error=sso_required`). The workspace owner is exempt (break-glass).

## SCIM 2.0 (`/scim/v2`, bearer `ScimToken`)

Tokens: `scim_` + 32 random bytes, stored as SHA-256 with prefix and last 4, up to 5 live per workspace,
managed at `/api/workspaces/:workspaceId/scim/tokens` (`GET`, `POST {label}` returns the token once,
`DELETE /:tokenId` revokes). Same guards as SSO with capability and plan `scim`. Audit
`scim.token_create|revoke`.

`scimAuth`: a live token of a live team workspace whose plan has `scim`; every failure is a SCIM error
(401 for any bad token). Rate limit 600/min per token. Every answer is `application/scim+json`.

| Endpoint | Notes |
| --- | --- |
| `GET /ServiceProviderConfig`, `/ResourceTypes`, `/Schemas` | patch and filter supported, no bulk, sort or etag. |
| `GET /Users?filter&startIndex&count` | filters: `userName`, `emails.value`, `externalId`, `displayName`, `active`, `id` with `eq`, joined by `and`; else 400 `invalidFilter`. Count ≤ 200. |
| `POST /Users` | creates the account (verified, no password: signs in with SSO; `user.scim {workspaceId, externalId}`) or adds an existing one; membership `source: 'scim'`, role = the first connection's `defaultRole` or editor; seats checked. 409 `uniqueness` when already a member. |
| `PUT`/`PATCH /Users/:id` | name, userName, externalId (only for accounts this workspace provisioned), `active`. PATCH takes `replace`/`add` with a path or a value object (Entra ID style). `active: false` suspends the membership, signs the person out and, for accounts provisioned here, sets `user.active = false` (no sign-in anywhere); the owner cannot be deactivated. |
| `DELETE /Users/:id` | removes the membership and group memberships, signs out; the account stays. |
| `GET|POST /Groups`, `GET|PUT|PATCH|DELETE /Groups/:id` | `WorkspaceGroup` (the share principals): `displayName`, `externalId`, members limited to the workspace's people. PATCH `add`/`remove` members (`members[value eq "id"]` or a list), `replace` name, externalId or members. Deleting a group drops its resource shares. |

Audit actor `scim` (the token id): `scim.user_create|activate|deactivate|delete`, `scim.group_create|update|delete`.

## Tests

`tests/sso.unit.test.ts` (domains, metadata, attribute mapping, group roles, OIDC authorization URL,
SCIM filters and paging) and `tests/integration/sso-scim.test.ts` (settings gates, metadata and DNS
verification, domain ownership, encrypted OIDC secrets, SP-initiated SAML sign-in with JIT and group
roles, replay, foreign domain, no JIT, tampered response, test sign-in and require SSO with the owner
exemption and the lock-out release, SCIM discovery, users, groups, isolation, revocation).
`tests/integration/samlIdp.ts` is a throwaway IdP (fresh key per run). Manual end-to-end against a
real IdP: `docs/deploy/sso.md`.
