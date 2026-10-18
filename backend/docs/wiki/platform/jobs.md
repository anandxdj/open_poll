---
summary: Cluster-wide periodic jobs with a Redis SET NX PX lock per tick (registerJob / startScheduler).
status: active
last_updated: 2026-10-19
---

# Scheduled jobs (`common/jobs/scheduler.ts`)

```ts
registerJob({ name: 'retention-purge', everyMs: 60 * 60_000, run: async ({ tick, signal }) => { … } });
startScheduler();          // once per instance at boot, after Redis connects (idempotent)
await stopScheduler();     // stops timers, aborts `signal`, waits for running jobs
```

- Register at module load (side effect of importing the module that owns the job). Names are
  unique (`[a-z0-9:_-]`), `everyMs` ≥ 1000.
- Time is cut into ticks of `everyMs` aligned to the epoch; each instance wakes just after a
  tick boundary and races for the Redis lock `jobs:{<name>}:tick:<tick>` (`SET NX PX`, kept 2
  ticks). Exactly one instance runs each tick.
- A second lock, `jobs:{<name>}:running` (`maxRunMs`, default `max(10 × everyMs, 1 min)`),
  is held for the whole run and released by compare-and-delete: if a run outlasts its tick,
  the next ticks are skipped everywhere instead of overlapping.
- A tick is **skipped, not retried**, when Redis is unavailable, the previous run is still
  going, or another instance won. Jobs must be idempotent and catch up on their own (e.g.
  purge everything older than X, not "the last hour").
- Job errors are logged; the scheduler keeps going. Long jobs should check `signal.aborted`
  between batches.
- `new Scheduler({ jobs, store, instanceId, now, log })` + `runTick(job, tick)` drive it
  deterministically in tests; `redisLockStore(client)` adapts any node-redis client.

Needs a long-lived process (not serverless). `common/jobs/start.ts` (W0-T) starts the existing
workers and is where `startScheduler()` belongs.
