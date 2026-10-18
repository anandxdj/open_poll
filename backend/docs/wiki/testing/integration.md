---
summary: Integration harness, fixtures, test-service setup, CI job and the W0-T dependency spikes.
status: active
last_updated: 2026-10-19
---

# Integration tests and spikes

Unit tests (`backend/tests/*.test.ts`) stub Mongo and Redis. Integration suites use real services
through the harness; spikes prove third-party libraries run under Bun. App wiring:
[`../http/app-and-routes.md`](../http/app-and-routes.md).

## Running

Use dedicated, throwaway services. `resetTestData()` empties every collection of the
`TEST_MONGO_URI` database and flushes the `TEST_REDIS_URL` Redis database.

```bash
docker run -d --name openpoll-test-mongo -p 127.0.0.1:27117:27017 mongo:7
docker run -d --name openpoll-test-redis -p 127.0.0.1:6390:6379 redis:7-alpine

cd backend
TEST_MONGO_URI='mongodb://127.0.0.1:27117/openpoll_test?directConnection=true' \
TEST_REDIS_URL=redis://127.0.0.1:6390/5 \
bun test integration tests/spikes
```

`integration` is a path filter: it runs `tests/integration/**` and every `*.integration.test.ts`
(the realtime and presentations-live suites). Keep new suites under one of those names.

Without both variables those suites skip, so plain `bun test` stays offline. Run from `backend/`:
`bunfig.toml` preloads `tests/preload.ts`, which copies `TEST_MONGO_URI`/`TEST_REDIS_URL` into
`MONGO_URI`/`REDIS_URL` before anything imports `common/config/env` or the shared Redis client.
The harness refuses to start if the app is not pointed at the test services.

CI: the `integration` job in `.github/workflows/ci.yml` runs the command above against `mongo:7` and
`redis:7` service containers. The `backend` job runs everything else.

## Harness (`tests/integration/harness.ts`)

| Export | Use |
| --- | --- |
| `describeIntegration` | `describe` that skips unless both services are configured. |
| `startTestServer()` | `createApp()` + Socket.io + `setupSocketAndPubSub` on `127.0.0.1:0`. Returns `{ app, httpServer, io, baseUrl, request, connectSocket, close }`. Call twice for two instances on one Redis. Interval workers are never started. |
| `request(path, init)` | `fetch` against the server; a plain-object `body` is sent as JSON. |
| `connectSocket(options)` | websocket-only `socket.io-client` socket, disconnected by `close()`. |
| `resetTestData()` | Empties all collections (indexes kept) and flushes the test Redis DB. |

Mongo and the shared `redisClient` connect with the first server and disconnect with the last
`close()`, so later unit-test files see the state they expect. The harness lifts the
`redisClient.isOpen` pin left by `mvp.smoke.test.ts` while it owns the client.

## Fixtures (`tests/integration/fixtures.ts`)

- `createVerifiedUser(overrides?)` → `{ id, email, name, password, accessToken, headers }`. Written to
  Mongo directly (`isVerified: true`); the token is signed like a real login.
- `createPoll(server, owner, overrides?)` → `POST /api/polls` (published, one question).
- `createPresentation(server, owner, overrides?)` → `POST /api/presentations` (one `select_answer` slide).

## Spikes (`tests/spikes/`)

| Spike | Result under Bun 1.4.3 | Notes for the owning package |
| --- | --- | --- |
| `saml.test.ts` (`@node-saml/node-saml` 5) | pass | Validates a signed Response + Assertion; rejects tampering and a wrong audience. Fixtures: `tests/fixtures/saml/` (regenerate with `bun tests/fixtures/saml/generate.ts`; needs `openssl`; the private key is never committed). Signing uses `xml-crypto` (devDependency). |
| `redisAdapter.test.ts` (`@socket.io/redis-adapter` 8 + node-redis 5) | pass | Cross-instance broadcast, `io.local` stays local, `fetchSockets`, `serverSideEmit`. Pub/sub ignores the Redis DB index: give each deployment its own adapter `key`. Needs `TEST_REDIS_URL`. |
| `pdf.test.ts` (`unpdf` + `@napi-rs/canvas`, `pdfkit`) | pass | `renderPageAsImage(data, page, { canvasImport: () => import('@napi-rs/canvas'), scale })`. pdf.js may detach the input buffer: pass a fresh `Uint8Array` per call. |
| `pptx.test.ts` (`fflate` + `fast-xml-parser`) | pass | Order from `sldIdLst` via rels; use `parseTagValue: false` so slide text stays a string. |
| `spreadsheet.test.ts` (`exceljs`, `papaparse`) | pass | Buffered and streamed (`stream.xlsx.WorkbookWriter`) XLSX both read back. |
| `stripe.test.ts` (`stripe` 23) | pass | Bun resolves stripe's worker build (SubtleCrypto): use `constructEventAsync`; sync `constructEvent` throws. |
| `metrics.test.ts` (`prom-client` 15) | pass | Default metrics collect; under Bun `nodejs_gc_duration_seconds` has no samples and `nodejs_active_handles_total` reads 0. |

Import fixtures (`tests/fixtures/import/`, regenerate with `bun tests/fixtures/import/generate.ts`):
`sample.pdf` (pdfkit, 2 A6 pages, a red square at a known position) and `sample.pptx` (fflate, a
complete minimal PresentationML package whose deck order differs from its part names). Their
contents are described in `constants.ts`.
