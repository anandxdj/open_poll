import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { registerJob, type JobContext } from '../../common/jobs/scheduler';
import { storage } from '../../common/storage/storage';
import { AuditEventModel } from '../audit/audit.model';
import { UserModel } from '../auth/auth.model';
import { syncSeatsAfterMembershipChange } from '../billing/seatSync';
import { ImportJobModel } from '../imports/import.model';
import { McpTokenModel } from '../mcp/mcp.token.model';
import { PollModel } from '../polls/polls.model';
import { PresentationModel, PresentationSessionModel } from '../presentations/presentations.model';
import { AnalyticsModel } from '../responses/analytics.model';
import { ResponseModel } from '../responses/responses.model';
import { purgeSessionData } from '../sessions/sessions.service';
import { MediaAssetModel } from '../uploads/media.model';
import { ResourceShareModel } from '../workspaces/resourceShare.model';
import { UsageCounterModel } from '../workspaces/usageCounter.model';
import { WorkspaceModel, type IWorkspace } from '../workspaces/workspace.model';
import { WorkspaceGroupModel } from '../workspaces/workspaceGroup.model';
import { WorkspaceInviteModel } from '../workspaces/workspaceInvite.model';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import { DataExportJobModel } from './privacy.model';
import { DELETION_GRACE_DAYS } from './privacy.service';

export const ACCOUNT_PURGE_JOB = 'privacy-account-purge';
export const RETENTION_PURGE_JOB = 'privacy-retention-purge';
/** Both jobs run hourly; a run only touches what is due. */
export const PRIVACY_JOBS_EVERY_MS = 60 * 60 * 1000;
/** The name a purged account keeps, so whatever it left in shared workspaces still has an author. */
export const DELETED_USER_NAME = 'Deleted user';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

const deletedEmail = (userId: Types.ObjectId) => `deleted-${String(userId)}@deleted.invalid`;

/** Deletes the matching sessions one by one, each with its participants, answers, Q&A and Redis keys. */
async function purgeSessionsWhere(filter: Record<string, unknown>): Promise<number> {
  let count = 0;
  for (;;) {
    const batch = await PresentationSessionModel.find(filter).limit(BATCH);
    if (batch.length === 0) return count;
    for (const session of batch) {
      await purgeSessionData(session);
      count += 1;
    }
  }
}

/** Polls and decks with their responses and sessions. */
async function purgeContent(filter: Record<string, unknown>) {
  const pollIds = (await PollModel.find(filter).select('_id').lean()).map((p) => p._id);
  if (pollIds.length) {
    await ResponseModel.deleteMany({ pollId: { $in: pollIds } });
    await AnalyticsModel.deleteMany({ pollId: { $in: pollIds } });
    await PollModel.deleteMany({ _id: { $in: pollIds } });
  }
  const deckIds = (await PresentationModel.find(filter).select('_id').lean()).map((d) => d._id);
  if (deckIds.length) {
    await purgeSessionsWhere({ presentationId: { $in: deckIds } });
    await PresentationModel.deleteMany({ _id: { $in: deckIds } });
  }
}

/** A workspace and everything in it: content, sessions, files, members, invites, groups, shares, counters. */
export async function purgeWorkspace(workspace: Pick<IWorkspace, '_id'>) {
  const workspaceId = workspace._id;
  await purgeContent({ workspaceId });
  const media = await MediaAssetModel.find({ workspaceId }).select('key').lean();
  if (storage.enabled) {
    for (const asset of media) await storage.delete(asset.key).catch(() => {});
  }
  await Promise.all([
    MediaAssetModel.deleteMany({ workspaceId }),
    ImportJobModel.deleteMany({ workspaceId }),
    WorkspaceInviteModel.deleteMany({ workspaceId }),
    WorkspaceGroupModel.deleteMany({ workspaceId }),
    ResourceShareModel.deleteMany({ workspaceId }),
    UsageCounterModel.deleteMany({ workspaceId }),
    WorkspaceMemberModel.deleteMany({ workspaceId }),
  ]);
  await WorkspaceModel.deleteOne({ _id: workspaceId });
}

/**
 * Leaves a team workspace that keeps other members. If the user was its only
 * owner (ownership changed hands during the grace period), the longest
 * standing admin, else member, becomes the owner.
 */
async function leaveWorkspace(workspace: IWorkspace, userId: Types.ObjectId) {
  await WorkspaceMemberModel.deleteOne({ workspaceId: workspace._id, userId });
  await WorkspaceGroupModel.updateMany({ workspaceId: workspace._id }, { $pull: { memberIds: userId } });
  await ResourceShareModel.deleteMany({ workspaceId: workspace._id, principalType: 'user', principalId: userId });
  const owners = await WorkspaceMemberModel.countDocuments({ workspaceId: workspace._id, role: 'owner', status: 'active' });
  if (owners === 0 || String(workspace.ownerId) === String(userId)) {
    const heir =
      (await WorkspaceMemberModel.findOne({ workspaceId: workspace._id, status: 'active', role: 'owner' }).sort({ createdAt: 1 })) ??
      (await WorkspaceMemberModel.findOne({ workspaceId: workspace._id, status: 'active', role: 'admin' }).sort({ createdAt: 1 })) ??
      (await WorkspaceMemberModel.findOne({ workspaceId: workspace._id, status: 'active' }).sort({ createdAt: 1 }));
    if (heir) {
      heir.role = 'owner';
      await heir.save();
      await WorkspaceModel.updateOne({ _id: workspace._id }, { $set: { ownerId: heir.userId } });
    }
  }
  syncSeatsAfterMembershipChange(workspace);
}

/**
 * Deletes an account for good. Its personal workspace and team workspaces it
 * was alone in go with everything in them; it leaves the others (its content
 * there stays with the workspace, credited to "Deleted user"). The user record
 * stays as a nameless tombstone so those references still resolve, the email
 * is freed, poll answers it sent elsewhere lose their link to it and its audit
 * events lose IP and browser.
 */
export async function purgeAccount(userId: Types.ObjectId) {
  const memberships = await WorkspaceMemberModel.find({ userId }).lean();
  const workspaces = await WorkspaceModel.find({ _id: { $in: memberships.map((m) => m.workspaceId) } });
  let deletedWorkspaces = 0;
  for (const workspace of workspaces) {
    const others = await WorkspaceMemberModel.countDocuments({ workspaceId: workspace._id, userId: { $ne: userId }, status: 'active' });
    if (workspace.type === 'personal' || others === 0) {
      await purgeWorkspace(workspace);
      deletedWorkspaces += 1;
    } else {
      await leaveWorkspace(workspace, userId);
    }
  }
  // Polls and decks from before workspaces, which no workspace purge reaches.
  await purgeContent({ creatorId: String(userId), workspaceId: null });

  await Promise.all([
    McpTokenModel.deleteMany({ userId }),
    DataExportJobModel.deleteMany({ userId }),
    WorkspaceMemberModel.deleteMany({ userId }),
    WorkspaceGroupModel.updateMany({ memberIds: userId }, { $pull: { memberIds: userId } }),
    ResourceShareModel.deleteMany({ principalType: 'user', principalId: userId }),
    // Each answer gets its own anonymous id, so they cannot be linked to each other either.
    ResponseModel.updateMany(
      { respondentId: String(userId) },
      [{ $set: { respondentId: { $concat: ['deleted:', { $toString: '$_id' }] } } }],
      { updatePipeline: true }
    ),
    AuditEventModel.updateMany({ actorId: userId }, { $set: { ip: null, ua: null } }),
  ]);

  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        email: deletedEmail(userId),
        name: DELETED_USER_NAME,
        active: false,
        isVerified: false,
        identities: [],
        scim: null,
        locale: null,
        defaultWorkspaceId: null,
        deletedAt: new Date(),
      },
      $unset: {
        password: 1,
        picture: 1,
        sub: 1,
        refreshToken: 1,
        verificationToken: 1,
        resetPasswordToken: 1,
        resetPasswordExpires: 1,
      },
    }
  );
  void audit({ actorType: 'system' }, 'account.purge', { type: 'user', id: userId }, { deletedWorkspaces });
}

/** Purges every account whose grace period has passed. */
export async function runAccountPurge(now = new Date(), signal?: AbortSignal) {
  const due = new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS);
  const totals = { purged: 0, failed: 0 };
  let after: Types.ObjectId | null = null;
  for (;;) {
    const filter: Record<string, unknown> = { deletionRequestedAt: { $ne: null, $lte: due }, deletedAt: null };
    if (after) filter._id = { $gt: after };
    const batch = await UserModel.find(filter).sort({ _id: 1 }).limit(BATCH).select('_id').lean();
    if (batch.length === 0) return totals;
    for (const user of batch) {
      if (signal?.aborted) return totals;
      try {
        await purgeAccount(user._id);
        totals.purged += 1;
      } catch (error) {
        totals.failed += 1;
        console.error(`[Privacy] Account purge failed for ${String(user._id)}:`, (error as Error)?.message);
      }
    }
    after = batch[batch.length - 1]!._id;
  }
}

/**
 * Deletes ended sessions past their retention date (`retainUntil`, set when
 * the session ends from the workspace's retention setting capped by its plan).
 */
export async function runRetentionPurge(now = new Date(), signal?: AbortSignal) {
  let sessions = 0;
  for (;;) {
    const batch = await PresentationSessionModel.find({ isLive: false, retainUntil: { $ne: null, $lte: now } }).limit(BATCH);
    if (batch.length === 0) return { sessions };
    for (const session of batch) {
      if (signal?.aborted) return { sessions };
      await purgeSessionData(session);
      sessions += 1;
    }
  }
}

registerJob({
  name: ACCOUNT_PURGE_JOB,
  everyMs: PRIVACY_JOBS_EVERY_MS,
  run: async ({ signal }: JobContext) => {
    const totals = await runAccountPurge(new Date(), signal);
    if (totals.purged || totals.failed) console.log(`[Privacy] Account purge: ${JSON.stringify(totals)}`);
  },
});

registerJob({
  name: RETENTION_PURGE_JOB,
  everyMs: PRIVACY_JOBS_EVERY_MS,
  run: async ({ signal }: JobContext) => {
    const totals = await runRetentionPurge(new Date(), signal);
    if (totals.sessions) console.log(`[Privacy] Retention purge: ${JSON.stringify(totals)}`);
  },
});
