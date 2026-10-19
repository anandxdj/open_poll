---
summary: App factory, boot order, middleware order, special mounts and the module mount table.
status: active
last_updated: 2026-10-19
---

# App factory and mount table

Code: `backend/src/app.ts`, `backend/src/http/`. Tests: `backend/tests/http.routes.test.ts`,
`backend/tests/http.createApp.test.ts`. Integration harness: [`../testing/integration.md`](../testing/integration.md).

## Files

| File | Role |
| --- | --- |
| `src/app.ts` | Boot only: env (first import), build the HTTP + Socket.io servers, `connectDB()`, `connectRedis()`, `setupSocketAndPubSub(io)`, `startJobs()`, listen on `env.PORT`. |
| `src/http/createApp.ts` | `createApp()` builds the Express app. Opens no connection, starts no worker, does not listen. |
| `src/http/routes.ts` | `mountPreParserRoutes(app)`, `mountRoutes(app)` (system routes + `MOUNTS` table), `LARGE_JSON_PATHS`. |
| `src/http/socketServer.ts` | `createSocketServer(httpServer)`: Socket.io with CORS from `env.allowedOrigins`. |
| `src/common/middlewares/cors.ts` | `corsMiddleware` (credentialed, `env.allowedOrigins`, no-Origin requests pass). W4-E extends it with custom domains. |
| `src/common/jobs/start.ts` | `startJobs()`: the analytics and live-distribution interval workers, and `startScheduler()` for jobs registered with `registerJob()` (see `../platform/jobs.md`). Only `app.ts` calls it. |

## Middleware order (`createApp`)

1. `trust proxy` = 1, `securityHeaders`
2. **Pre-parser mounts** (`mountPreParserRoutes`), ahead of CORS, the global JSON parser and `mongoSanitize`:

   | Path | Parser | Router | Why it is early |
   | --- | --- | --- | --- |
   | `/api/billing/webhook` | `express.raw({type:'application/json', limit:'1mb'})` | `billingWebhookRouter` (W3-C, `modules/billing.md`) | Stripe signs the raw bytes; `req.body` is a Buffer. |
   | `/api/sso/saml/:connectionId/acs` | `express.urlencoded({extended:false, limit:'1mb'})` | `samlAcsRouter` (`mergeParams`) | The IdP form post is cross-origin; the CORS allow-list would reject its Origin. |
   | `/scim/v2` | `express.json({type:['application/json','application/scim+json'], limit:'1mb'})` | `scimRouter` | `mongoSanitize` strips keys containing `.` (`urn:…:2.0:User`). |
   | `/metrics` | none | `metricsRouter` | Prometheus scrape, bearer token, no browser context. |

3. `corsMiddleware` (a rejected origin reaches `errorHandler` → 500, as before)
4. `express.json({limit:'1mb'})` on `LARGE_JSON_PATHS` (`/api/presentations`, `/api/quizzes`), then `express.json({limit:'100kb'})` for everything else (a body parsed by the first is skipped by the second)
5. `cookieParser()`, `mongoSanitize`
6. `mountRoutes`: `GET /health`, `GET /ready`, root `GET /auth/callback` (registered OIDC redirect URI), then `MOUNTS`
7. `errorHandler`. There is no custom 404: unmatched requests get Express's default 404, as before the split.

Handlers on the pre-parser routers must not rely on `cookieParser` or `mongoSanitize`, and they get
no CORS headers. A request they do not answer falls through to the normal chain.

## Mount table (`MOUNTS`)

Express tries mounts in order. Blocks: nested mounts first (ahead of the router owning the parent
path), then the modules that predate the table in their original order, then the rest alphabetical.
One line per entry.

| Path | Router (file) | Filled by |
| --- | --- | --- |
| `/api/presentations/:presentationId/host/qna` | `qnaHostRouter` (`modules/qna/qna.route.ts`) | W2-B |
| `/api/presentations/:presentationId/qna` | default (`modules/qna/qna.route.ts`) | W2-B |
| `/api/workspaces/:workspaceId/domains` | default (`modules/domains/domains.route.ts`) | W4-E |
| `/api/auth`, `/api/polls`, `/api/responses`, `/api/ai`, `/api/presentations`, `/api/quizzes` (alias), `/api/mcp`, `/mcp` | existing modules | — |
| `/api/audit` | `modules/audit/audit.route.ts` | W3-B1 |
| `/api/billing` | `modules/billing/billing.route.ts` | W3-C |
| `/api/brand-kits` | `brandKitsRouter` (`modules/themes/themes.route.ts`) | W3-A |
| `/api/capabilities` | `modules/capabilities/capabilities.route.ts` | W0-D |
| `/api/embeds` | `modules/embeds/embeds.route.ts` | W4-D |
| `/api/folders` | `modules/folders/folders.route.ts` | W3-B2 |
| `/api/imports` | `modules/imports/imports.route.ts` | W3-E |
| `/api/insights` | `modules/insights/insights.route.ts` | W3-G |
| `/api/library` | `modules/library/library.route.ts` | W1-C |
| `/api/me` | `modules/privacy/privacy.route.ts` | W4-C |
| `/api/oembed` | `oembedRouter` (`modules/embeds/embeds.route.ts`) | W4-D |
| `/api/plans` | `plansRouter` (`modules/billing/billing.route.ts`) | W3-C |
| `/api/public/domains` | `publicDomainsRouter` (`modules/domains/domains.route.ts`) | W4-E |
| `/api/public/results` | `publicResultsRouter` (`modules/sessions/sessions.route.ts`) | W2-C |
| `/api/remote` | `modules/remote/remote.route.ts` | W2-A |
| `/api/sessions` | `modules/sessions/sessions.route.ts` | W2-C |
| `/api/sso` | `modules/sso/sso.route.ts` | W3-D |
| `/api/templates` | `modules/templates/templates.route.ts` | W3-B2 |
| `/api/themes` | `modules/themes/themes.route.ts` | W3-A |
| `/api/uploads` | `modules/uploads/uploads.route.ts` | W0-D |
| `/api/workspaces` | `modules/workspaces/workspaces.route.ts` | W1-B |

Pre-parser stubs: `samlAcsRouter` (W3-D), `scim.route.ts` (W3-D),
`metrics.route.ts` (W2-D).

## Adding routes

- A planned module only fills its router file; `routes.ts` already mounts it. Routers mounted on a
  path with params (`qna`, `domains`, `samlAcsRouter`) are `Router({ mergeParams: true })`.
- A path the table does not cover yet gets one new line in the right block of `MOUNTS`.
- Any change to middleware, mounts or routes changes the route snapshot. Regenerate it with
  `UPDATE_ROUTE_SNAPSHOT=1 bun test tests/http.routes.test.ts` and review the diff of
  `tests/http.routes.snapshot.txt` (one line per layer, in order: `USE <path> <fn>`,
  `ROUTER <path>`, `<METHOD> <full path>`). `tests/helpers/routes.ts` records mount paths, which
  Express 5's router does not keep.
