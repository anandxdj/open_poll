---
summary: Prometheus metrics (GET /metrics), what each series means, how routes are labelled, and the answer-storm load test and its CI job.
status: active
last_updated: 2026-10-19
---

# Observability (`common/observability/`, `modules/metrics/`)

W2-D. One `prom-client` registry per process; Prometheus scrapes **each instance** and sums.
Metrics are always collected (a few counters and histograms); only the endpoint needs
configuration.

## Endpoint

`GET /metrics`, mounted by `src/http/routes.ts` before CORS and the body parsers.

| Situation | Response |
| --- | --- |
| `METRICS_TOKEN` unset | **404** for everyone, `GET /api/capabilities` → `metrics: false`. The endpoint is never open. |
| token set, no / wrong / malformed `Authorization: Bearer <token>` | 401 with `WWW-Authenticate: Bearer realm="metrics"` |
| token set, correct bearer | 200, `text/plain; version=0.0.4`, `Cache-Control: no-store` |

The token (≥ 16 characters, `.env.example`) is compared in constant time (SHA-256 of both sides
through `timingSafeEqual`). The route is rate limited (120/min/IP, `rl:metrics:*`), so a leaked
URL cannot be used to guess the token. Prometheus config:

```yaml
scrape_configs:
  - job_name: openpoll
    metrics_path: /metrics
    authorization: { type: Bearer, credentials: <METRICS_TOKEN> }
    static_configs: [{ targets: ['backend-1:8080', 'backend-2:8080'] }]
```

Every series has the label `app="openpoll-backend"` (default label).

## Series

| Series | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `openpoll_http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | Latency of every HTTP request except `/metrics`. `route` is the Express route **pattern** (`/api/presentations/:id/answer`); requests no route matched are `unmatched`. Never a raw URL, so ids cannot blow up cardinality. Buckets 5 ms … 5 s. |
| `openpoll_socket_connections` | gauge | — | Socket.io connections open on this instance. |
| `openpoll_answers_accepted_total` | counter | `via` (`rest`/`socket`/`offline`), `replay` | Accepted answers; `replay="true"` is a repeat of an accepted answer (nothing counted twice). |
| `openpoll_answers_rejected_total` | counter | `via`, `reason` | Refused answers by reason: `not_accepting`, `time_up`, `already_answered`, `rate_limited`, `participant_kicked`, `participant_stale`, `http_<status>` (e.g. `http_401`, `http_400` for malformed), `error`. |
| `openpoll_answer_duration_seconds` | histogram | `via` | Server time to handle one answer, validation to reply. Buckets 1 ms … 1 s. |
| `openpoll_redis_command_duration_seconds` | histogram | `op`, `outcome` | Redis calls on the live hot path: `answer_script`, `answer_window`, `coalescer_take`, `autoreveal_poll`. |
| `openpoll_live_answer_updates_total` | counter | — | Coalesced host `answer:received` events published. |
| `openpoll_live_auto_reveals_total` | counter | — | Scored timed slides revealed by the engine. |
| `process_*`, `nodejs_*` | default | — | prom-client defaults (under Bun, `nodejs_gc_duration_seconds` has no samples and `nodejs_active_handles_total` reads 0). |

Useful queries:

```promql
histogram_quantile(0.95, sum by (le) (rate(openpoll_answer_duration_seconds_bucket[1m])))
sum(rate(openpoll_answers_accepted_total[1m]))                 # answers/s across instances
sum by (reason) (rate(openpoll_answers_rejected_total[5m]))    # why answers are refused
sum(openpoll_socket_connections)
```

Code: `common/observability/metrics.ts` (registry and series), `httpMetrics.middleware.ts` (mounted
first in `createApp()`; it takes the route label when the router assigns `req.route`, because
Express resets `req.baseUrl` when an error leaves a router), `redisTiming.ts` (`timeRedis(op, fn)`
wraps hot-path Redis calls), `modules/metrics/metrics.route.ts` (auth).

## Load test

`backend/loadtest/answer-storm.ts` (Bun) drives the real backend with N virtual phones answering a
deck slide by slide, over REST, Socket.io or both, **open loop** (latency counts from the moment an
answer was due, so a slow server cannot hide behind a slow client), then checks nothing was lost:
every accepted answer reached Mongo, the session's `answerCount` matches, and participant scores equal
the sum of answer scores. Exit code 1 when a threshold or a check fails.

```bash
cd backend
# start a backend on a free port, storm it, stop it (point MONGO_URI / REDIS_URL at throwaway services)
MONGO_URI='mongodb://127.0.0.1:27117/openpoll_load?directConnection=true' REDIS_URL=redis://127.0.0.1:6390/6 \
  bun loadtest/answer-storm.ts --spawn --mode rest --participants 500 --slides 10 --rate 600
bun loadtest/answer-storm.ts --base-url http://127.0.0.1:5000 --mode mixed --rate 0   # burst, half sockets
```

Flags and env vars (`STORM_*`) are in the script header: `--mode rest|socket|mixed`, `--participants`,
`--slides`, `--rate` (answers/s offered, 0 = everyone at once), `--min-rps` (500), `--max-p95-ms` (150),
`--spawn`, `--base-url`, `--json`. Each phone sends its own `X-Forwarded-For` (the backend trusts one
proxy hop), so per-IP rate limits see a room of phones. The script creates its host account in Mongo
and lifts the workspace's audience cap, so it must share `MONGO_URI` and the JWT secrets with the
server; never aim it at a shared database. With `--spawn` it scrapes `/metrics` for the server-side
p95.

`backend/loadtest/answer-rest.k6.js` is the same REST traffic for k6 (reports, ramping, cloud):
`answer-storm.ts --prepare-only --participants 6000` writes `loadtest/.fixture.json` (gitignored) and
opens slide 0; `k6 run loadtest/answer-rest.k6.js` answers it at a constant arrival rate with k6
thresholds on p95, failures and accepted/s (env: `RATE`, `MIN_RPS`, `MAX_P95_MS`, `BASE_URL`,
`FIXTURE`). The fixture is single use. With Docker:
`docker run --rm --network host -v "$PWD/loadtest:/loadtest:ro" grafana/k6 run /loadtest/answer-rest.k6.js`.

CI: the `loadtest-smoke` job in `.github/workflows/ci.yml` (own job, mongo + redis services) runs
500 phones × 10 slides at 600 answers/s over REST and over Socket.io and fails below
`STORM_MIN_RPS` (500) or above `STORM_MAX_P95_MS` (150); override with the repository variables of the
same names. `.github/workflows/loadtest-nightly.yml` (03:23 UTC and manual) runs 1000 phones × 20
slides at 2,000/s with thresholds 1,900/s and 150 ms.

Reference numbers (one developer machine, Bun 1.4.3, backend + generator + Mongo + Redis on it):

| Run | Accepted/s | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| REST, 500 phones × 8 slides, 600/s offered | 600 | 2.2 ms | 5.6 ms | 8.3 ms |
| REST, 1000 × 10, 2,000/s | 1,967 | 3.2 ms | 16.9 ms | 27.2 ms |
| Socket.io, 800 × 8, 2,000/s | 1,991 | 2.3 ms | 8.8 ms | 14.9 ms |
| Mixed, 1000 × 6, burst (all at once) | 8,281 | 80 ms | 147 ms | 178 ms |
| k6 REST, 6,000 phones, 600/s | 600 | 0.9 ms | 3.2 ms | — |
