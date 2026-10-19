import { redisClient } from '../../common/config/redis';

/**
 * Cross-instance coalescing for high-frequency live events (`qna:votes`,
 * `reaction:burst`): every change is recorded in a session-scoped Redis
 * structure, and the instance whose `SET lock NX PX <window>` succeeds
 * schedules the one flush for that window. The flush reads and clears the
 * structure and the lock in one script, so a change made after it either lands
 * in the next window (it takes the lock again) or was included — never lost.
 * If the scheduling instance dies, the lock expires and the next change on any
 * instance flushes everything pending.
 */

export const COALESCE_WINDOW_MS = 500;

/** Minimal Redis surface the coalescer needs (the shared client, or a test double). */
export interface EvalClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

// KEYS: [set, lock]  ARGV: [member, ttlSec, windowMs] → 1 when this call took the lock.
const MARK_SET_SCRIPT = `
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
if redis.call('SET', KEYS[2], '1', 'NX', 'PX', ARGV[3]) then return 1 end
return 0
`;

// KEYS: [set, lock] → the members, then both keys are gone.
const DRAIN_SET_SCRIPT = `
local members = redis.call('SMEMBERS', KEYS[1])
redis.call('DEL', KEYS[1], KEYS[2])
return members
`;

// KEYS: [hash, lock, rate?]  ARGV: [field, by, ttlSec, windowMs, rateMax?, rateWindowSec?]
// → -1 over the rate limit (nothing recorded), 1 when this call took the lock, else 0.
const MARK_HASH_SCRIPT = `
if KEYS[3] then
  local used = redis.call('INCR', KEYS[3])
  if used == 1 then redis.call('EXPIRE', KEYS[3], ARGV[6]) end
  if used > tonumber(ARGV[5]) then return -1 end
end
redis.call('HINCRBY', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
if redis.call('SET', KEYS[2], '1', 'NX', 'PX', ARGV[4]) then return 1 end
return 0
`;

// KEYS: [hash, lock] → flat [field, value, …], then both keys are gone.
const DRAIN_HASH_SCRIPT = `
local entries = redis.call('HGETALL', KEYS[1])
redis.call('DEL', KEYS[1], KEYS[2])
return entries
`;

export interface SetCoalescer {
  /** Records `member`; resolves true when this call scheduled the flush. */
  mark(member: string): Promise<boolean>;
}

/** `limited`: over the rate limit, nothing recorded; `scheduled`: this call scheduled the flush; `queued`: a flush is already scheduled. */
export type HashAddResult = 'limited' | 'scheduled' | 'queued';

/** An atomic fixed-window cap checked in the same script (its key must share the data key's hash tag). */
export interface CoalescerRate {
  key: string;
  max: number;
  windowSec: number;
}

export interface HashCoalescer {
  /** Adds `by` to `field` unless `rate` is exhausted. */
  add(field: string, by?: number, rate?: CoalescerRate): Promise<HashAddResult>;
}

interface CoalescerOptions<T> {
  keys: { data: string; lock: string };
  ttlSec: number;
  windowMs?: number;
  /** Called once per window with what was drained (never with an empty batch). */
  flush: (batch: T) => Promise<void> | void;
  client?: EvalClient;
  /** Timer seam for tests. */
  schedule?: (fn: () => void, ms: number) => void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  (timer as { unref?: () => void }).unref?.();
};

const runFlush = async <T>(
  client: EvalClient,
  script: string,
  keys: string[],
  parse: (raw: unknown) => T | null,
  flush: (batch: T) => Promise<void> | void,
  label: string
) => {
  try {
    const batch = parse(await client.eval(script, { keys, arguments: [] }));
    if (batch !== null) await flush(batch);
  } catch (error) {
    console.error(`[Coalescer] ${label} flush failed:`, error);
  }
};

/** Coalesces a set of member ids per window (e.g. questions whose votes changed). */
export const setCoalescer = (options: CoalescerOptions<string[]>): SetCoalescer => {
  const client = options.client ?? redisClient;
  const windowMs = options.windowMs ?? COALESCE_WINDOW_MS;
  const schedule = options.schedule ?? defaultSchedule;
  const keys = [options.keys.data, options.keys.lock];
  return {
    async mark(member) {
      const took = Number(
        await client.eval(MARK_SET_SCRIPT, {
          keys,
          arguments: [member, String(options.ttlSec), String(windowMs)],
        })
      );
      if (took !== 1) return false;
      schedule(
        () =>
          void runFlush(
            client,
            DRAIN_SET_SCRIPT,
            keys,
            (raw) => {
              const members = Array.isArray(raw) ? raw.map(String) : [];
              return members.length ? members : null;
            },
            options.flush,
            options.keys.data
          ),
        windowMs
      );
      return true;
    },
  };
};

/** Coalesces per-field counters per window (e.g. emoji counts). */
export const hashCoalescer = (options: CoalescerOptions<Record<string, number>>): HashCoalescer => {
  const client = options.client ?? redisClient;
  const windowMs = options.windowMs ?? COALESCE_WINDOW_MS;
  const schedule = options.schedule ?? defaultSchedule;
  const keys = [options.keys.data, options.keys.lock];
  return {
    async add(field, by = 1, rate) {
      const result = Number(
        await client.eval(MARK_HASH_SCRIPT, {
          keys: rate ? [...keys, rate.key] : keys,
          arguments: [
            field,
            String(by),
            String(options.ttlSec),
            String(windowMs),
            ...(rate ? [String(rate.max), String(rate.windowSec)] : []),
          ],
        })
      );
      if (result === -1) return 'limited';
      if (result !== 1) return 'queued';
      schedule(
        () =>
          void runFlush(
            client,
            DRAIN_HASH_SCRIPT,
            keys,
            (raw) => {
              const flat = Array.isArray(raw) ? raw.map(String) : [];
              const counts: Record<string, number> = {};
              for (let i = 0; i + 1 < flat.length; i += 2) {
                const count = Number(flat[i + 1]);
                if (count > 0) counts[flat[i]!] = count;
              }
              return Object.keys(counts).length ? counts : null;
            },
            options.flush,
            options.keys.data
          ),
        windowMs
      );
      return 'scheduled';
    },
  };
};
