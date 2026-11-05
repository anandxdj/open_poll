import { createHash } from 'crypto';
import { hostname } from 'os';
import { env } from '../config/env';
import { redisClient } from '../config/redis';
import { sendAlertEmail } from '../config/email';

/**
 * Emails ALERT_EMAIL about server errors nobody handled: a 500 from the HTTP error handler, a
 * failed scheduled job, an unhandled rejection or an uncaught exception. Without ALERT_EMAIL (or
 * without a mail provider) it does nothing beyond what the caller already logged.
 *
 * Throttled so a broken endpoint cannot flood the inbox: one email per error fingerprint per hour
 * and at most DAILY_CAP a day, shared by every instance through Redis (a per-process fallback
 * when Redis is down). Never throws and never logs request bodies, query strings or user data.
 */
export const ALERT_THROTTLE_SECONDS = 60 * 60;
export const ALERT_DAILY_CAP = 20;

export interface AlertMeta {
  [key: string]: string | number | undefined;
}

const localSeen = new Map<string, number>();
let localDay = '';
let localDayCount = 0;

const asError = (value: unknown): { name: string; message: string; stack?: string } => {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return { name: 'NonError', message: typeof value === 'string' ? value : safeJson(value) };
};

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value)?.slice(0, 500) ?? String(value);
  } catch {
    return String(value);
  }
};

/** Same bug, same fingerprint: ids, numbers and hex in the message don't make a new alert. */
export function errorFingerprint(context: string, error: unknown): string {
  const { name, message, stack } = asError(error);
  const normalized = message.replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, '#');
  const frame = stack?.split('\n').find((line) => line.trim().startsWith('at ')) ?? '';
  return createHash('sha256').update(`${context}|${name}|${normalized}|${frame.trim()}`).digest('hex').slice(0, 16);
}

/** True when an alert with this fingerprint may go out now (exported for tests). */
export async function allowAlert(fingerprint: string, now = Date.now()): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  if (redisClient.isReady) {
    const fresh = await redisClient.set(`rl:alert:fp:${fingerprint}`, '1', { NX: true, EX: ALERT_THROTTLE_SECONDS });
    if (fresh !== 'OK') return false;
    const dayKey = `rl:alert:day:${day}`;
    const count = await redisClient.incr(dayKey);
    if (count === 1) await redisClient.expire(dayKey, 2 * 24 * 60 * 60);
    return count <= ALERT_DAILY_CAP;
  }
  const last = localSeen.get(fingerprint);
  if (last && now - last < ALERT_THROTTLE_SECONDS * 1000) return false;
  localSeen.set(fingerprint, now);
  if (localDay !== day) {
    localDay = day;
    localDayCount = 0;
  }
  localDayCount += 1;
  return localDayCount <= ALERT_DAILY_CAP;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Builds the alert email. Exported for tests. */
export function alertContent(context: string, error: unknown, meta: AlertMeta, at = new Date()) {
  const { name, message, stack } = asError(error);
  const subject = `[Open Poll] ${context}: ${message}`.slice(0, 120);
  const rows = Object.entries({ context, ...meta, instance: hostname(), time: at.toISOString() })
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(key)}</td><td>${escapeHtml(String(value))}</td></tr>`)
    .join('');
  const trace = (stack ?? `${name}: ${message}`).split('\n').slice(0, 15).join('\n');
  const html =
    `<p style="margin:0 0 12px">An error reached the server's last line of defence. ` +
    `Repeats of this error are muted for an hour.</p>` +
    `<table style="font:13px monospace;border-collapse:collapse">${rows}</table>` +
    `<pre style="font:12px monospace;white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:6px">${escapeHtml(trace)}</pre>`;
  return { subject, html };
}

/**
 * Reports an unhandled error by email (see the module comment). The caller logs it; this only
 * alerts. Safe to fire and forget.
 */
export async function notifyError(context: string, error: unknown, meta: AlertMeta = {}): Promise<void> {
  const to = env.alertEmail;
  if (!to || !env.mail.resendApiKey) return;
  try {
    if (!(await allowAlert(errorFingerprint(context, error)))) return;
    const { subject, html } = alertContent(context, error, meta);
    await sendAlertEmail(to, subject, html);
  } catch (alertError) {
    console.error('[Alerts] could not send an alert:', (alertError as Error)?.message);
  }
}

/** Test hook: forgets the per-process throttle. */
export function resetLocalAlertThrottle() {
  localSeen.clear();
  localDay = '';
  localDayCount = 0;
}
