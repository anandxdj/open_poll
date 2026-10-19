import mongoose, { type QueryFilter, type Types } from 'mongoose';
import { z } from 'zod';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import { AuditEventModel, type AuditActorType, type IAuditEvent } from './audit.model';

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 100;

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id format');
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** `GET /api/audit` query string. */
export const auditQuerySchema = z.object({
  /** An exact action (`member.remove`), or a prefix ending in `*` (`member.*`). */
  action: optional(z.string().trim().min(1).max(100).regex(/^[a-z0-9_.]+\*?$/i, 'Invalid action filter')),
  /** The acting user's id. */
  actor: optional(objectId),
  cursor: optional(z.string().max(200)),
  limit: optional(z.coerce.number().int().min(1).max(AUDIT_MAX_LIMIT)).transform((value) => value ?? AUDIT_DEFAULT_LIMIT),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** The workspace's request context (after authenticate() + workspaceContext()). */
export type AuditContext = PolicyContext & { workspace: { _id: Types.ObjectId } };

export interface AuditEventView {
  id: string;
  action: string;
  actorType: AuditActorType;
  /** null for system events and for actors that no longer exist. */
  actor: { id: string; name: string; email: string } | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  ua: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditPage {
  events: AuditEventView[];
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
  /** Every action the workspace has recorded, for the filter (first page only). */
  actions: string[];
}

interface Cursor {
  t: number;
  id: string;
}

const encodeCursor = (event: Pick<IAuditEvent, 'createdAt' | '_id'>): string =>
  Buffer.from(JSON.stringify({ t: event.createdAt.getTime(), id: String(event._id) } satisfies Cursor)).toString('base64url');

function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof parsed.t === 'number' && Number.isFinite(parsed.t) && typeof parsed.id === 'string' && /^[a-f0-9]{24}$/i.test(parsed.id)) {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    // fall through
  }
  throw ApiError.badRequest('Invalid cursor');
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class AuditService {
  /**
   * One page of the workspace's audit events, newest first (keyset on
   * `{createdAt, _id}`, so concurrent inserts never skip or repeat a row).
   * Needs `workspace:manage`. Events are kept as long as the plan's
   * `auditRetentionDays` says (TTL index); there is no plan feature gate.
   */
  static async list(ctx: AuditContext, query: AuditQuery): Promise<AuditPage> {
    assertCan(ctx, 'workspace:manage');
    const workspaceId = ctx.workspace._id;

    const filter: QueryFilter<IAuditEvent> = { workspaceId };
    if (query.action) {
      filter.action = query.action.endsWith('*')
        ? { $regex: `^${escapeRegex(query.action.slice(0, -1))}` }
        : query.action;
    }
    if (query.actor) filter.actorId = new mongoose.Types.ObjectId(query.actor);
    if (query.cursor) {
      const { t, id } = decodeCursor(query.cursor);
      const at = new Date(t);
      filter.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: new mongoose.Types.ObjectId(id) } }];
    }

    const rows = await AuditEventModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean();
    const page = rows.slice(0, query.limit);

    const actorIds = [...new Set(page.flatMap((event) => (event.actorType === 'user' && event.actorId ? [String(event.actorId)] : [])))];
    const users = actorIds.length ? await UserModel.find({ _id: { $in: actorIds } }).select('name email').lean() : [];
    const byId = new Map(users.map((user) => [String(user._id), user]));

    const events = page.map((event): AuditEventView => {
      const user = event.actorId ? byId.get(String(event.actorId)) : undefined;
      return {
        id: String(event._id),
        action: event.action,
        actorType: event.actorType,
        actor: user ? { id: String(user._id), name: user.name, email: user.email } : null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        ip: event.ip ?? null,
        ua: event.ua ?? null,
        meta: event.meta ?? null,
        createdAt: event.createdAt,
      };
    });

    const last = page.at(-1);
    return {
      events,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
      actions: query.cursor ? [] : ((await AuditEventModel.distinct('action', { workspaceId })) as string[]).sort(),
    };
  }
}
