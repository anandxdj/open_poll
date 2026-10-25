import { redisCommandDuration } from './metrics';

/**
 * Times one Redis call (or a short sequence of them) on the live hot path into
 * `openpoll_redis_command_duration_seconds{op, outcome}`. Wrap calls whose
 * latency matters under load (the answer script, window lookups, coalescer
 * flushes); everything else stays unwrapped.
 */
export const timeRedis = async <T>(op: string, run: () => Promise<T>): Promise<T> => {
  const started = performance.now();
  try {
    const result = await run();
    redisCommandDuration.observe({ op, outcome: 'ok' }, (performance.now() - started) / 1000);
    return result;
  } catch (error) {
    redisCommandDuration.observe({ op, outcome: 'error' }, (performance.now() - started) / 1000);
    throw error;
  }
};
