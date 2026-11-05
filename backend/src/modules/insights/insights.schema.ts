import { z } from 'zod';

/** Longest range one request may ask for. */
export const MAX_RANGE_DAYS = 366;
/** Range when the query gives none. */
export const DEFAULT_RANGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/**
 * `GET /api/insights` query: `from` / `to` (ISO dates, `to` defaults to now and
 * `from` to 30 days before it) and `tz`, the IANA time zone days are counted in
 * (default UTC).
 */
export const insightsQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    tz: z.string().max(64).refine(isTimeZone, 'tz must be an IANA time zone').default('UTC'),
  })
  .transform(({ from, to, tz }, ctx) => {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    if (start >= end) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must be before to' });
      return z.NEVER;
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: `Ranges are at most ${MAX_RANGE_DAYS} days` });
      return z.NEVER;
    }
    return { from: start, to: end, tz };
  });
export type InsightsQuery = z.output<typeof insightsQuerySchema>;
