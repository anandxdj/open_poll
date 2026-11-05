import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { sendAccountDeletionEmail } from '../../common/config/email';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import type { AuthRequest } from '../auth/auth.middleware';
import { McpTokenModel } from '../mcp/mcp.token.model';
import { McpGrantModel } from '../mcp/oauth/oauth.grant.model';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import { buildUserExport } from './privacy.export';
import { DataExportJobModel } from './privacy.model';

/** How recent the proof of identity must be for DELETE /api/me. */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;
/** Days between the deletion request and the purge; signing in cancels it. */
export const DELETION_GRACE_DAYS = 30;
/** Exports per user per rolling 24 hours. */
export const EXPORTS_PER_DAY = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Stripe subscription states that still bill. */
const BILLING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

export const PRIVACY_ERROR_CODES = {
  reauthRequired: 'REAUTH_REQUIRED',
  wrongPassword: 'WRONG_PASSWORD',
  noPassword: 'NO_PASSWORD',
  soleOwner: 'SOLE_OWNER',
  activeSubscription: 'ACTIVE_SUBSCRIPTION',
  exportLimit: 'EXPORT_LIMIT',
} as const;

const reauthKey = (userId: string) => `privacy:reauth:${userId}`;

export interface WorkspaceRef {
  workspaceId: string;
  name: string;
  type: 'personal' | 'team';
}

/** What stops an account from being deleted right now. */
export interface DeletionBlockers {
  /** Team workspaces with other members where the user is the only owner: transfer ownership first. */
  soleOwner: WorkspaceRef[];
  /** Workspaces deleted with the account that still have a paid subscription: cancel it first. */
  subscriptions: WorkspaceRef[];
}

export interface ExportRecord {
  id: string;
  status: string;
  bytes: number;
  createdAt: string;
}

export interface PrivacyStatus {
  hasPassword: boolean;
  /** Until when DELETE /api/me needs no new proof of identity; null when it needs one now. */
  reauthUntil: string | null;
  deletionGraceDays: number;
  /** Workspaces deleted with the account, and those the user would leave. */
  workspaces: { deleted: WorkspaceRef[]; left: WorkspaceRef[] };
  blockers: DeletionBlockers;
  exports: ExportRecord[];
  exportsLeftToday: number;
}

const ref = (workspace: { _id: unknown; name: string; type: WorkspaceRef['type'] }): WorkspaceRef => ({
  workspaceId: String(workspace._id),
  name: workspace.name,
  type: workspace.type,
});

/** What deleting the account would do to each workspace the user belongs to. */
export interface DeletionImpact {
  /** Deleted with the account: the personal workspace and team workspaces with no other member. */
  deleted: WorkspaceRef[];
  /** Team workspaces the user leaves; what they made there stays with the team. */
  left: WorkspaceRef[];
  blockers: DeletionBlockers;
}

/**
 * Workspaces the account's deletion affects: the personal one and team
 * workspaces where the user is the only member are deleted with it; from the
 * others the user only leaves, which needs another owner.
 */
export async function deletionImpact(userId: string): Promise<DeletionImpact> {
  const uid = new Types.ObjectId(userId);
  const memberships = await WorkspaceMemberModel.find({ userId: uid, status: 'active' }).lean();
  const workspaces = await WorkspaceModel.find({
    _id: { $in: memberships.map((m) => m.workspaceId) },
    deletedAt: null,
  })
    .sort({ type: 1, createdAt: 1 })
    .lean();
  const impact: DeletionImpact = { deleted: [], left: [], blockers: { soleOwner: [], subscriptions: [] } };

  for (const workspace of workspaces) {
    const others = await WorkspaceMemberModel.find({ workspaceId: workspace._id, userId: { $ne: uid }, status: 'active' })
      .select('role')
      .lean();
    const role = memberships.find((m) => String(m.workspaceId) === String(workspace._id))?.role;
    const deletedWithAccount = workspace.type === 'personal' || others.length === 0;
    (deletedWithAccount ? impact.deleted : impact.left).push(ref(workspace));
    if (!deletedWithAccount && role === 'owner' && !others.some((m) => m.role === 'owner')) {
      impact.blockers.soleOwner.push(ref(workspace));
    }
    const billing = workspace.billing ?? {};
    const paying =
      workspace.planSource === 'stripe' &&
      BILLING_STATUSES.has(String(billing.status ?? '')) &&
      !billing.cancelAtPeriodEnd;
    if (deletedWithAccount && paying) impact.blockers.subscriptions.push(ref(workspace));
  }
  return impact;
}

/** Until when the caller counts as having just proved who they are, or null. */
async function reauthUntil(req: AuthRequest): Promise<Date | null> {
  const user = req.user!;
  const fromSignIn = user.authTime ? user.authTime * 1000 + REAUTH_WINDOW_MS : 0;
  const confirmed = Number((await redisClient.get(reauthKey(user.id)).catch(() => null)) ?? 0);
  const until = Math.max(fromSignIn, confirmed);
  return until > Date.now() ? new Date(until) : null;
}

const exportsSince = (userId: string, since: Date) =>
  DataExportJobModel.countDocuments({ userId: new Types.ObjectId(userId), status: 'delivered', createdAt: { $gt: since } });

export class PrivacyService {
  static async status(req: AuthRequest): Promise<PrivacyStatus> {
    const userId = req.user!.id;
    const [user, until, impact, exports, recent] = await Promise.all([
      UserModel.findById(userId).select('+password').lean(),
      reauthUntil(req),
      deletionImpact(userId),
      DataExportJobModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(5).lean(),
      exportsSince(userId, new Date(Date.now() - DAY_MS)),
    ]);
    if (!user) throw ApiError.unauthorized('User no longer exists');
    return {
      hasPassword: Boolean(user.password),
      reauthUntil: until ? until.toISOString() : null,
      deletionGraceDays: DELETION_GRACE_DAYS,
      workspaces: { deleted: impact.deleted, left: impact.left },
      blockers: impact.blockers,
      exports: exports.map((job) => ({
        id: String(job._id),
        status: job.status,
        bytes: job.bytes,
        createdAt: job.createdAt.toISOString(),
      })),
      exportsLeftToday: Math.max(0, EXPORTS_PER_DAY - recent),
    };
  }

  /** Builds the archive and records the export; 429 EXPORT_LIMIT after EXPORTS_PER_DAY in 24 hours. */
  static async export(req: AuthRequest) {
    const userId = req.user!.id;
    if ((await exportsSince(userId, new Date(Date.now() - DAY_MS))) >= EXPORTS_PER_DAY) {
      throw new ApiError(429, `You can download your data ${EXPORTS_PER_DAY} times a day. Try again tomorrow.`, PRIVACY_ERROR_CODES.exportLimit);
    }
    try {
      const archive = await buildUserExport(userId);
      const job = await DataExportJobModel.create({ userId, status: 'delivered', bytes: archive.bytes.byteLength });
      void audit(req, 'account.export', { type: 'user', id: userId }, { bytes: archive.bytes.byteLength });
      return { job, archive };
    } catch (error) {
      await DataExportJobModel.create({ userId, status: 'failed' }).catch(() => {});
      throw error;
    }
  }

  /** Password accounts confirm their password; the next REAUTH_WINDOW_MS count as a fresh sign-in. */
  static async reauth(req: AuthRequest, password: string): Promise<{ reauthUntil: string }> {
    const userId = req.user!.id;
    const user = await UserModel.findById(userId).select('+password');
    if (!user) throw ApiError.unauthorized('User no longer exists');
    if (!user.password) {
      throw new ApiError(400, 'This account has no password. Sign in again to confirm it is you.', PRIVACY_ERROR_CODES.noPassword);
    }
    if (!(await user.comparePassword(password))) {
      // Not 401: the client reads 401 as an expired token and refreshes.
      throw new ApiError(400, 'That password is not right', PRIVACY_ERROR_CODES.wrongPassword);
    }
    const until = Date.now() + REAUTH_WINDOW_MS;
    await redisClient.set(reauthKey(userId), String(until), { PX: REAUTH_WINDOW_MS });
    return { reauthUntil: new Date(until).toISOString() };
  }

  /**
   * Schedules the account's deletion: sign-ins and tokens stop working now,
   * the purge job deletes it after DELETION_GRACE_DAYS, and signing in before
   * then cancels it. Needs a fresh proof of identity and no blockers.
   */
  static async requestDeletion(req: AuthRequest): Promise<{ purgeAt: string }> {
    const userId = req.user!.id;
    if (!(await reauthUntil(req))) {
      throw new ApiError(403, 'Confirm it is you before deleting your account', PRIVACY_ERROR_CODES.reauthRequired);
    }
    const { blockers } = await deletionImpact(userId);
    if (blockers.soleOwner.length) {
      throw new ApiError(
        409,
        'You are the only owner of a workspace with other members. Make someone else an owner first.',
        PRIVACY_ERROR_CODES.soleOwner,
        { workspaces: blockers.soleOwner }
      );
    }
    if (blockers.subscriptions.length) {
      throw new ApiError(
        409,
        'Cancel the paid plan of the workspaces deleted with your account first.',
        PRIVACY_ERROR_CODES.activeSubscription,
        { workspaces: blockers.subscriptions }
      );
    }

    const user = await UserModel.findById(userId);
    if (!user) throw ApiError.unauthorized('User no longer exists');
    const now = new Date();
    user.deletionRequestedAt = now;
    user.set('refreshToken', undefined);
    await user.save();
    // MCP tokens and connected apps act as the user: they go now, whatever happens next.
    await McpTokenModel.deleteMany({ userId: user._id });
    await McpGrantModel.deleteMany({ userId: user._id });
    await redisClient.del(reauthKey(userId)).catch(() => {});

    const purgeAt = new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS);
    void audit(req, 'account.deletion_request', { type: 'user', id: userId }, { purgeAt: purgeAt.toISOString() });
    void sendAccountDeletionEmail(user.email, purgeAt).catch((error: Error) =>
      console.error('Failed to send account deletion email:', error?.message)
    );
    return { purgeAt: purgeAt.toISOString() };
  }
}
