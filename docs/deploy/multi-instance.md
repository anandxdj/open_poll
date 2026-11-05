---
summary: Running several backend instances behind one load balancer - what is shared, what runs where, the settings that matter, scaling numbers, and a rollout checklist.
status: active
last_updated: 2026-10-19
---

# Running more than one backend instance

The backend is stateless between requests: sessions, answers, scores and events live in Redis and
Mongo, so any number of instances can serve the same deployment. This page is for whoever operates
it. Reference deployment: the Traefik/compose stack in `docker-compose.yml` (scale the
`openpoll-backend` service); the same holds behind any load balancer. Sockets, timers, the job
scheduler and import workers need a **long-lived process** (compose, a VM or a container that stays
up), not a function that sleeps between requests.

## What is shared and how

| Concern | How it works across instances |
| --- | --- |
| Live answers | One Redis script per answer on the session's keys (`psess:{<sid>}:*`, hash-tagged, one Cluster slot per session). Dedup, scores and counters are exact whichever instance took the answer. |
| Live events | Published once to the Redis channel `live:event` (with a per-deck `seq`); **every** instance subscribes and delivers to its own sockets with `io.local`. A phone connected to instance A gets events published by instance B. |
| Host update after answers | One Redis key (`psess:{sid}:dirty`, `SET NX PX 250`) picks the instance that publishes the coalesced `answer:received` for each 250 ms window; exactly one update per window. |
| Socket.io rooms | Local to each instance unless `SOCKET_REDIS_ADAPTER=on`. Events do not need it; room operations that reach sockets on other instances (`fetchSockets`, `disconnectSockets`, as kicking a participant or a presenter remote will need) do. |
| Mongo writes of answers | Each instance writes its own accepted answers in batches; a duplicate key means someone else (reconciliation, a replay) stored it first and is ignored. Totals are exact because ending a session recounts them (`scoreFinalAt`). |
| Auto-reveal of scored timed slides | A global schedule (`live:autoreveal` ZSET) polled by every instance every 250 ms; the successful `ZREM` picks the one that reveals. |
| Scheduled jobs | `common/jobs/scheduler.ts` takes a Redis lock per job: one instance runs each job per tick. |
| MCP (`/mcp`) | Stateless Streamable HTTP: each request builds its own server from the bearer token, so any instance answers any call and no stickiness is needed. OAuth requests and codes for connectors live in Redis (`mcp:oauth:*`), grants in Mongo. |
| Rate limits | Redis counters (`rl:*`), shared. Per-IP limits assume the load balancer sets `X-Forwarded-For` (the app trusts exactly one proxy hop). |
| Migrations | `bun run start:prod` runs them before the server starts; they are idempotent and lock guarded, so every instance can run them on boot. |

## Settings

| Variable | Set it to | Why |
| --- | --- | --- |
| `REDIS_URL`, `MONGO_URI` | the same Redis and Mongo for every instance | shared state |
| `SOCKET_REDIS_ADAPTER` | `on` when more than one instance serves sockets | cross-instance rooms (`fetchSockets`, `disconnectSockets`, `socketsJoin`). Costs two extra Redis connections per instance. Leave unset for a single instance. |
| `METRICS_TOKEN` | a random string ≥ 16 characters | enables `GET /metrics` (bearer auth) on every instance; Prometheus scrapes each instance and sums ([`backend/docs/wiki/platform/observability.md`](../../backend/docs/wiki/platform/observability.md)) |
| `ID_SIGNING_SECRET` (or `JWT_ACCESS_SECRET`), `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` | identical on every instance | device tokens, slide tickets and sessions are HMAC-signed; an instance with another secret rejects the others' tokens |
| `FRONTEND_URL` / allowed origins | the public site | CORS and socket origin check |

Everything that signs or verifies a token must share its secret across instances; rotate secrets with
all instances at once.

## Load balancer

- **WebSocket upgrade** must pass through (Traefik does by default). The browser client
  (`frontend/lib/socket.ts`) connects with `transports: ['websocket', 'polling']`: it tries a
  WebSocket first and falls back to HTTP long-polling only when that fails. A WebSocket needs no
  stickiness, but Socket.io's polling fallback does (its handshake and requests must reach the same
  instance). Either enable cookie stickiness at the load balancer (Traefik:
  `traefik.http.services.openpoll-backend.loadbalancer.sticky.cookie=true`) or make the client
  websocket-only. REST calls never need stickiness.
- Idle timeout above 60 s for sockets (Socket.io pings every 25 s).
- Forward the client address in `X-Forwarded-For` and have the proxy **append**, not trust, an
  inbound value, or per-IP limits can be spoofed.
- Health: `GET /health` (process up) and `GET /ready` (Mongo and Redis connected). Use `/ready` for
  load balancer checks and rolling deploys.
- Drain on deploy: stop routing new traffic, let sockets reconnect (clients resync with `live-state` /
  `live:resync`), then stop the instance. A batch of answers still queued in a stopping instance
  (at most 50 ms of work) is restored from Redis when the session ends.

## Redis

Redis is the hot path of every answer, so size it for it, not the app: one script call per answer,
plus the pub/sub. The measured numbers below used a single local Redis. Notes:

- Persistence (`appendonly yes` in the compose file) is for restarts; a session whose Redis keys are
  lost degrades (windows and tokens rebuild from Mongo) but cannot reopen a closed slide.
- **Redis Cluster** is safe for the answer path: every key of a session shares the hash tag
  `{<sid>}`. The global keys (`live:autoreveal`, `live:{pid}:seq`, `buffer:*`, `rl:*`) are single-key
  operations. Pub/sub in Cluster is broadcast to all nodes; the adapter and `live:event` work as is.
- Pub/sub ignores the Redis database index. Deployments sharing one Redis server need distinct
  Socket.io adapter keys (`RedisAdapterOptions.key`) and must not share a database for `rl:*` and
  `live:*` keys if they must stay apart.
- Never run `KEYS` against it: nothing in the app does (the analytics worker keeps a per-poll set).

## Scaling numbers

Measured with `backend/loadtest/answer-storm.ts` on one developer machine, with backend, load generator,
Mongo and Redis sharing it (so real deployments have headroom):

| Load | Result |
| --- | --- |
| 500 phones × 8 slides, 600 answers/s offered, REST | 600/s sustained, p95 5.6 ms |
| 1000 phones × 10 slides, 2,000/s, REST | 1,967/s, p95 16.9 ms |
| 800 phones × 8 slides, 2,000/s, Socket.io | 1,991/s, p95 8.8 ms |
| 1000 phones, all answering at once (burst), half REST half sockets | 8,281/s, p95 147 ms |

CI guards the floor on every push (`loadtest-smoke`: 600/s offered, ≥ 500/s accepted, p95 < 150 ms) and
the 2,000/s target nightly (`loadtest-nightly.yml`). Plan limits cap one session's audience
(`common/plans/plans.ts`, `audienceCap`: free 100, pro 1,000, team 2,000, enterprise 10,000 by default).

What to watch (`/metrics`): `openpoll_answer_duration_seconds` p95, `openpoll_answers_rejected_total` by
reason (`rate_limited` and `time_up` spikes mean clients or the network struggle),
`openpoll_redis_command_duration_seconds{op="answer_script"}`, `openpoll_socket_connections` per
instance (imbalance means the load balancer is not spreading new connections).

## Rollout checklist

1. Deploy with **no live session** when a release changes Redis key formats or the answer script's
   KEYS/ARGV (this release adds keys but does not change existing ones). The script reloads itself
   after a Redis restart or `SCRIPT FLUSH`.
2. Same secrets and the same `SOCKET_REDIS_ADAPTER` on every instance.
3. Point the load balancer health check at `/ready`.
4. Set `METRICS_TOKEN`, add each instance as a scrape target, alert on answer p95 and on `5xx` by
   `route`.
5. Smoke test: `bun loadtest/answer-storm.ts --base-url https://<host> --mode mixed --participants 200
   --slides 3` from a machine with the deployment's `MONGO_URI` and secrets, against a throwaway
   workspace (it creates a host account and a deck; never run it against production data you care about).
6. Connect two browsers to different instances (the `openpoll_socket_connections` gauge shows which)
   and confirm that a host action on one reaches the phone on the other.
