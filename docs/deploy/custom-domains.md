# Custom domains: operator setup

Workspaces on Enterprise can serve their participant pages (joining, live sessions, shared
results, embeds, public polls) on their own hostname. Everything else on that hostname moves to the
same path on the main site.

## Backend

| Variable | Value |
| --- | --- |
| `DOMAIN_PROVISIONER` | `caddy` (Caddy issues certificates on demand) or `vercel` (the frontend runs on Vercel). `none` or unset keeps the feature off. |
| `DOMAIN_CNAME_TARGET` | The hostname customers point their CNAME at, e.g. `domains.openpoll.example`. It must reach the frontend. |
| `DOMAIN_VERCEL_TOKEN`, `DOMAIN_VERCEL_PROJECT_ID`, `DOMAIN_VERCEL_TEAM_ID` | With `vercel`: a token that can add domains to the frontend project. |

## Frontend

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CUSTOM_DOMAINS` | `on` turns the custom-domain proxy step on. |
| `NEXT_PUBLIC_SITE_URL` | The main site; its host (with localhost and `*.vercel.app`) is never treated as a custom domain. |
| `NEXT_PUBLIC_PRIMARY_HOSTS` | Other hosts that are the main site (comma list), e.g. `www.openpoll.example`. |

The proxy asks the API which workspace a host belongs to (`GET /api/public/domains/resolve`) and
keeps the answer for a minute. Unknown hosts are sent to the main site.

## Caddy

```caddyfile
{
  on_demand_tls {
    ask https://api.openpoll.example/api/public/domains/tls-ask
  }
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy frontend:3000
}
```

## What a workspace admin does

Settings, Custom domains: add `polls.theircompany.com`, create the CNAME (to `DOMAIN_CNAME_TARGET`) and
the TXT record (`_openpoll.polls.theircompany.com`) shown there, then Check DNS. On white-label plans the
pages on their domain don't say "Made with Open Poll", and the join page shows their brand kit.
