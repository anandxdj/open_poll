---
summary: Custom domains and white-label (W4-E): hostname CRUD, DNS verification, provisioners, host resolution, Caddy TLS ask, CORS for active domains.
status: active
last_updated: 2026-10-26
---

# Custom domains (`src/modules/domains/`)

A workspace on a plan with `custom_domains` (Enterprise) serves its participant pages on its own
hostname, e.g. `polls.acme.com`. Server switch: `DOMAIN_PROVISIONER=vercel|caddy` with
`DOMAIN_CNAME_TARGET` (`none` keeps it off). Operator setup: `docs/deploy/custom-domains.md`.

## Model (`customDomain.model.ts`, migration 190)

`CustomDomain {workspaceId, hostname (unique, lower case), status: pending|active|failed,
verificationToken, checks {txt, cname, checkedAt, error}, provisioner, activatedAt, createdBy}`, up to
10 per workspace. Active hostnames are also in the Redis set `domains:active`.

## Settings API (`/api/workspaces/:workspaceId/domains`, pathWorkspaceContext)

Guards: capability `customDomains` (503 `DOMAINS_DISABLED`), `workspace:domains`, plan `custom_domains`.

| Route | What |
| --- | --- |
| `GET /` | `{cnameTarget, domains}`; each view lists the two records to create (`CNAME host → cnameTarget`, `TXT _openpoll.host = openpoll-verify=<token>`) with `found`, the last check's `error`, `url`. |
| `POST / {hostname}` | 400 `DOMAIN_INVALID`, 400 `DOMAIN_RESERVED` (the frontend, API and CNAME target hosts and their subdomains), 409 `DOMAIN_TAKEN`, 409 `DOMAIN_LIMIT`. |
| `POST /:domainId/verify` | Checks both records (`common/utils/dnsVerify.ts`, `dns.resolveCname`). Both found: the provisioner adds the host, status `active`, the host joins `domains:active`. A provisioner error leaves `failed` with the message. |
| `DELETE /:domainId` | Leaves `domains:active`, the provisioner removes the host (errors are logged), the record goes. |

Audit: `domain.create|verify|delete`.

## Provisioners (`provisioners.ts`)

- `vercel`: attaches the hostname to the frontend project (`POST /v10/projects/:id/domains`,
  `DELETE /v9/projects/:id/domains/:host`, `teamId` when set); 409 on add and 404 on remove count as done.
- `caddy`: nothing to call; Caddy's on-demand TLS asks `GET /api/public/domains/tls-ask` first.

## Public (`/api/public/domains`, allow-listed)

- `GET /resolve?host` → `{hostname, workspace {id, name}, whiteLabel, theme}` for an active domain of a
  live workspace whose plan still has `custom_domains` (else 404). `theme` is the workspace's default
  theme when it is not the built-in look (brand kit logo and colours for the join page).
  `Cache-Control: public, max-age=60`.
- `GET /tls-ask?domain` → 200 for an active hostname, 404 otherwise.

## CORS

`common/middlewares/cors.ts` allows `env.allowedOrigins`, then any origin whose hostname is an active
custom domain (`isActiveDomainOrigin`: Redis set first, Mongo when the set is cold; https only in
production). Account purge removes a workspace's domains from the set.

## Tests

`tests/domains.unit.test.ts` (Vercel calls) and `tests/integration/domains.test.ts` (gates, add rules,
verification with stubbed DNS, provisioning, resolve, TLS ask, CORS preflight, removal, plan downgrade).
