import { beforeEach, describe, expect, it } from 'bun:test';
import { parseEnv } from '../src/common/config/env';
import {
  ALERT_DAILY_CAP,
  ALERT_THROTTLE_SECONDS,
  alertContent,
  allowAlert,
  errorFingerprint,
  resetLocalAlertThrottle,
} from '../src/common/observability/alerts';
import { Scheduler, type JobDefinition, type JobLockStore } from '../src/common/jobs/scheduler';

// The unit run has no Redis connection, so allowAlert takes its per-process fallback.
beforeEach(() => resetLocalAlertThrottle());

describe('error fingerprint', () => {
  it('ignores ids and numbers in the message', () => {
    const a = new Error('Deck 6aec348a253c5a591b79c0c5 not found after 3 tries');
    const b = new Error('Deck 6a849d79e7c0ae89ed2cd3ca not found after 12 tries');
    b.stack = a.stack;
    expect(errorFingerprint('http', a)).toBe(errorFingerprint('http', b));
  });

  it('separates contexts and different errors', () => {
    const error = new Error('boom');
    expect(errorFingerprint('http', error)).not.toBe(errorFingerprint('job:purge', error));
    expect(errorFingerprint('http', new TypeError('x is undefined'))).not.toBe(errorFingerprint('http', new Error('boom')));
  });

  it('accepts values that are not errors', () => {
    expect(errorFingerprint('unhandledRejection', { reason: 'nope' })).toHaveLength(16);
    expect(errorFingerprint('unhandledRejection', undefined)).toHaveLength(16);
  });
});

describe('alert throttle', () => {
  it('sends one alert per fingerprint per hour', async () => {
    const t0 = Date.UTC(2026, 10, 5, 8);
    expect(await allowAlert('fp-a', t0)).toBe(true);
    expect(await allowAlert('fp-a', t0 + 60_000)).toBe(false);
    expect(await allowAlert('fp-b', t0 + 60_000)).toBe(true);
    expect(await allowAlert('fp-a', t0 + ALERT_THROTTLE_SECONDS * 1000 + 1)).toBe(true);
  });

  it('stops after the daily cap and starts again the next day', async () => {
    const day = Date.UTC(2026, 10, 5, 1);
    for (let i = 0; i < ALERT_DAILY_CAP; i += 1) expect(await allowAlert(`fp-${i}`, day)).toBe(true);
    expect(await allowAlert('fp-over', day)).toBe(false);
    expect(await allowAlert('fp-next-day', day + 24 * 60 * 60 * 1000)).toBe(true);
  });
});

describe('alert content', () => {
  it('escapes HTML and carries only the meta it is given', () => {
    const error = new Error('<script>alert(1)</script>');
    const { subject, html } = alertContent('http', error, { method: 'GET', route: '/api/polls/:id' });
    expect(subject.startsWith('[Open Poll] http: <script>')).toBe(true);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('/api/polls/:id');
    expect(html).toContain('GET');
  });

  it('keeps the subject short and the stack to 15 lines', () => {
    const error = new Error('x'.repeat(300));
    error.stack = ['Error: x', ...Array.from({ length: 40 }, (_, i) => `    at frame${i} (file.ts:${i})`)].join('\n');
    const { subject, html } = alertContent('job:privacy-retention-purge', error, {});
    expect(subject.length).toBeLessThanOrEqual(120);
    expect(html).toContain('frame13');
    expect(html).not.toContain('frame14 ');
  });
});

describe('ALERT_EMAIL', () => {
  it('is off by default and validated as an email', () => {
    expect(parseEnv({}).env.alertEmail).toBeNull();
    expect(parseEnv({ ALERT_EMAIL: 'ops@example.com' }).env.alertEmail).toBe('ops@example.com');
    expect(() => parseEnv({ ALERT_EMAIL: 'not-an-email' })).toThrow();
  });
});

describe('scheduler onJobError', () => {
  const store: JobLockStore = { acquire: async () => true, release: async () => {} };
  const quiet = { log: () => {}, error: () => {} };

  it('hands a failing job error to the callback and keeps going', async () => {
    const seen: Array<{ name: string; message: string }> = [];
    const job: JobDefinition = { name: 'flaky', everyMs: 60_000, run: () => Promise.reject(new Error('db down')) };
    const scheduler = new Scheduler({
      jobs: [job],
      store,
      log: quiet,
      onJobError: (name, error) => seen.push({ name, message: (error as Error).message }),
    });
    expect(await scheduler.runTick(job, 1)).toBe(true);
    expect(seen).toEqual([{ name: 'flaky', message: 'db down' }]);
  });

  it('survives a callback that throws', async () => {
    const job: JobDefinition = { name: 'flaky2', everyMs: 60_000, run: () => Promise.reject(new Error('x')) };
    const scheduler = new Scheduler({
      jobs: [job],
      store,
      log: quiet,
      onJobError: () => {
        throw new Error('mail down');
      },
    });
    expect(await scheduler.runTick(job, 1)).toBe(true);
  });
});
