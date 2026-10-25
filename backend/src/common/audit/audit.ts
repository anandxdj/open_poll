import type { Request } from 'express';
import { AuditEventModel, type AuditActorType } from '../../modules/audit/audit.model';
import { getEntitlements, type EntitlementSubject } from '../plans/entitlements';
import { PLANS } from '../plans/plans';

type IdLike = string | { toString(): string };

export interface AuditTarget {
  type: string;
  id?: IdLike | null;
}

/** An authenticated request (optionally with workspace context). */
type AuditRequest = Pick<Request, 'ip' | 'headers'> & {
  user?: { id: string } | null;
  workspace?: (EntitlementSubject & { _id: IdLike }) | null;
};

/** For callers without a request: jobs, scripts, SCIM, webhooks. */
export interface AuditActor {
  actorType: AuditActorType;
  actorId?: IdLike | null;
  workspace?: (EntitlementSubject & { _id: IdLike }) | null;
  ip?: string | null;
  ua?: string | null;
}

const isActor = (source: AuditRequest | AuditActor): source is AuditActor => 'actorType' in source;

/** Without a workspace there is no plan to read; keep events as long as the free plan does. */
const DEFAULT_RETENTION_DAYS = PLANS.free.limits.auditRetentionDays ?? 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Records an audit event. Fire-and-forget: never throws and never delays the
 * caller beyond scheduling the insert; failures are logged. The returned
 * promise (always fulfilled) is only for tests and scripts that must wait.
 *
 * `source` is the request (actor = req.user, workspace = req.workspace, plus
 * IP and user agent) or an explicit actor for work outside a request.
 * Retention (TTL via expiresAt) follows the workspace plan's auditRetentionDays.
 */
export function audit(
  source: AuditRequest | AuditActor,
  action: string,
  target?: AuditTarget | null,
  meta?: Record<string, unknown> | null,
): Promise<void> {
  try {
    const actor = isActor(source)
      ? { actorType: source.actorType, actorId: source.actorId ?? null, ip: source.ip ?? null, ua: source.ua ?? null }
      : {
          actorType: (source.user ? 'user' : 'system') as AuditActorType,
          actorId: source.user?.id ?? null,
          ip: source.ip ?? null,
          ua: typeof source.headers?.['user-agent'] === 'string' ? source.headers['user-agent'].slice(0, 512) : null,
        };
    const workspace = source.workspace ?? null;
    // null (unlimited) keeps the event: no expiresAt, so the TTL index skips it.
    const retentionDays = workspace ? getEntitlements(workspace).limits.auditRetentionDays : DEFAULT_RETENTION_DAYS;

    return AuditEventModel.create({
      workspaceId: workspace ? String(workspace._id) : null,
      actorId: actor.actorId ? String(actor.actorId) : null,
      actorType: actor.actorType,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id != null ? String(target.id) : null,
      ip: actor.ip,
      ua: actor.ua,
      meta: meta ?? null,
      expiresAt: retentionDays === null ? null : new Date(Date.now() + retentionDays * DAY_MS),
    }).then(
      () => undefined,
      (error: unknown) => console.error(`[Audit] Failed to record ${action}:`, (error as Error)?.message),
    );
  } catch (error) {
    console.error(`[Audit] Failed to record ${action}:`, (error as Error)?.message);
    return Promise.resolve();
  }
}
