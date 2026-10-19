import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { sendWorkspaceInviteEmail } from '../../common/config/email';
import { env } from '../../common/config/env';
import { assertCan } from '../../common/tenancy/policy';
import type { MemberStatus, WorkspaceRole } from '../../common/tenancy/roles';
import { ApiError } from '../../common/utils/ApiError';
import { hashToken } from '../../common/utils/jwt.utils';
import { UserModel } from '../auth/auth.model';
import type { CreateInviteInput } from './members.schema';
import { assertSeats, countActiveMembers, countPendingInvites, memberChangeDenial, personalWorkspaceError, type MembersActor } from './members.service';
import { WorkspaceModel, type IWorkspace } from './workspace.model';
import { WorkspaceInviteModel, type IWorkspaceInvite } from './workspaceInvite.model';
import { WorkspaceMemberModel, type IWorkspaceMember } from './workspaceMember.model';

/** How long an invitation link works. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

const invalidInvite = () => new ApiError(404, 'This invitation is invalid, has expired or was already used', 'INVITE_INVALID');

/** The emailed token: 256 random bits, never stored (only its SHA-256 is). */
export const generateInviteToken = () => randomBytes(32).toString('base64url');
export const hashInviteToken = (token: string) => hashToken(token);
export const inviteUrl = (token: string) => `${env.FRONTEND_URL}/invites/${token}`;

/** `ana@example.com` → `a**@example.com`: enough for the invitee to recognise it, not to harvest it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

/** One pending invitation, as the members page lists it. The token is never part of it. */
export interface InviteView {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: { id: string; name: string } | null;
}

/** What the accept page may show before sign-in (the link itself is the credential). */
export interface InvitePreview {
  workspaceName: string;
  role: WorkspaceRole;
  /** Masked: the page tells the invitee which address to sign in with. */
  email: string;
  inviterName: string | null;
  expiresAt: Date;
}

export interface CreatedInvite {
  invite: InviteView;
  /** The single-use link. Returned once, to the inviter, for sharing by hand when mail is not delivered. */
  inviteUrl: string;
  /** false when mail is not configured or the provider failed; the link above still works. */
  emailSent: boolean;
  /** true when an invite for this address already existed and was refreshed (new link, new expiry). */
  refreshed: boolean;
}

/** POST /api/invites/:token/accept: where the user landed. */
export interface AcceptedInvite {
  workspace: { _id: string; name: string; slug: string; type: IWorkspace['type'] };
  membership: { role: WorkspaceRole; status: MemberStatus };
  /** The invite was for someone already in the workspace: it is consumed, the membership unchanged. */
  alreadyMember: boolean;
}

/** The accepted invite and workspace too, for the controller's audit event. */
export interface AcceptResult {
  accepted: AcceptedInvite;
  invite: IWorkspaceInvite;
  workspace: IWorkspace;
}

async function toViews(invites: readonly IWorkspaceInvite[]): Promise<InviteView[]> {
  const inviterIds = [...new Set(invites.flatMap((invite) => (invite.invitedBy ? [String(invite.invitedBy)] : [])))];
  const inviters = inviterIds.length ? await UserModel.find({ _id: { $in: inviterIds } }).select('name').lean() : [];
  const names = new Map(inviters.map((user) => [String(user._id), user.name]));
  return invites.map((invite) => ({
    id: String(invite._id),
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
    invitedBy: invite.invitedBy
      ? { id: String(invite.invitedBy), name: names.get(String(invite.invitedBy)) ?? 'Former member' }
      : null,
  }));
}

/** The pending invite behind a token plus its live team workspace, or 404 INVITE_INVALID. */
async function findUsableInvite(token: string): Promise<{ invite: IWorkspaceInvite; workspace: IWorkspace }> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalidInvite();
  const invite = await WorkspaceInviteModel.findOne({ tokenHash: hashInviteToken(token), expiresAt: { $gt: new Date() } });
  if (!invite) throw invalidInvite();
  const workspace = await WorkspaceModel.findOne({ _id: invite.workspaceId, deletedAt: null, type: 'team' });
  if (!workspace) throw invalidInvite();
  return { invite, workspace };
}

export class InvitesService {
  /**
   * Invites an address to the team workspace, or refreshes its pending invite
   * (one per workspace and address: the link and expiry are replaced, so an
   * earlier link stops working). Needs `workspace:members`; assigns roles up
   * to the caller's own rank; the invitee takes a seat only when they accept,
   * but pending invites count against the plan's seats so the list cannot be
   * over-filled.
   */
  static async create(actor: MembersActor, input: CreateInviteInput): Promise<CreatedInvite> {
    assertCan(actor, 'workspace:members');
    const { workspace } = actor;
    if (workspace.type === 'personal') throw personalWorkspaceError();
    const denial = memberChangeDenial(actor.membership.role, 'viewer', input.role);
    if (denial) throw new ApiError(403, denial, 'ROLE_NOT_ASSIGNABLE');

    const existingUser = await UserModel.findOne({ email: input.email }).select('_id').lean();
    if (existingUser) {
      const member = await WorkspaceMemberModel.findOne({ workspaceId: workspace._id, userId: existingUser._id }).lean();
      if (member) {
        throw new ApiError(409, 'This person is already a member of the workspace', 'ALREADY_MEMBER', { status: member.status });
      }
    }

    const [active, pendingOthers] = await Promise.all([
      countActiveMembers(workspace._id),
      countPendingInvites(workspace._id, input.email),
    ]);
    assertSeats(workspace, active + pendingOthers + 1);

    const token = generateInviteToken();
    const { invite, refreshed } = await upsertInvite(workspace._id, input, token, actor.user.id);
    const [view] = await toViews([invite]);

    const url = inviteUrl(token);
    const emailSent = await sendWorkspaceInviteEmail(input.email, {
      url,
      workspaceName: workspace.name,
      inviterName: actor.user.name ?? 'A teammate',
      role: input.role,
      expiresAt: invite.expiresAt,
    }).catch(() => false);
    return { invite: view!, inviteUrl: url, emailSent, refreshed };
  }

  /** Unexpired invitations of the workspace, newest first. Needs `workspace:members`. */
  static async list(actor: MembersActor): Promise<InviteView[]> {
    assertCan(actor, 'workspace:members');
    const invites = await WorkspaceInviteModel.find({ workspaceId: actor.workspace._id, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(500);
    return toViews(invites);
  }

  /** Withdraws a pending invitation: its link stops working at once. */
  static async revoke(actor: MembersActor, inviteId: string): Promise<IWorkspaceInvite> {
    assertCan(actor, 'workspace:members');
    const invite = /^[a-f0-9]{24}$/i.test(inviteId)
      ? await WorkspaceInviteModel.findOneAndDelete({ _id: inviteId, workspaceId: actor.workspace._id })
      : null;
    if (!invite) throw new ApiError(404, 'Invitation not found', 'INVITE_NOT_FOUND');
    return invite;
  }

  /** What an invite link is for. Public: the link is the credential, so 404 for anything else. */
  static async preview(token: string): Promise<InvitePreview> {
    const { invite, workspace } = await findUsableInvite(token);
    const [view] = await toViews([invite]);
    return {
      workspaceName: workspace.name,
      role: invite.role,
      email: maskEmail(invite.email),
      inviterName: view?.invitedBy?.name ?? null,
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Joins the signed-in user to the workspace the token names. The user's
   * verified email must be the invited address. Single use: the invite is
   * claimed with one atomic delete, so two simultaneous accepts cannot both
   * win. Seats are checked again here. A suspended member cannot rejoin this
   * way; someone already in keeps their role.
   */
  static async accept(userId: string, token: string): Promise<AcceptResult> {
    const { invite, workspace } = await findUsableInvite(token);

    const user = await UserModel.findById(userId).select('email isVerified active');
    if (!user || user.active === false) throw ApiError.unauthorized('User no longer exists');
    if (!user.isVerified) {
      throw new ApiError(403, 'Verify your email address before accepting an invitation', 'EMAIL_NOT_VERIFIED');
    }
    if (user.email.toLowerCase() !== invite.email) {
      throw new ApiError(403, 'This invitation was sent to a different email address', 'INVITE_EMAIL_MISMATCH');
    }

    const existing = await WorkspaceMemberModel.findOne({ workspaceId: workspace._id, userId });
    if (existing && existing.status === 'suspended') {
      throw new ApiError(403, 'Your membership of this workspace is suspended', 'MEMBER_SUSPENDED');
    }
    if (!existing) assertSeats(workspace, (await countActiveMembers(workspace._id)) + 1);

    // The claim: whoever deletes the invite first owns this acceptance.
    const claimed = await WorkspaceInviteModel.findOneAndDelete({ _id: invite._id, tokenHash: invite.tokenHash });
    if (!claimed) throw invalidInvite();

    let membership: IWorkspaceMember | null = existing;
    let created = false;
    if (!membership) {
      try {
        membership = await WorkspaceMemberModel.create({
          workspaceId: workspace._id,
          userId,
          role: claimed.role,
          status: 'active',
          source: 'manual',
        });
        created = true;
      } catch (error) {
        if (isDuplicateKey(error)) {
          membership = await WorkspaceMemberModel.findOne({ workspaceId: workspace._id, userId });
        } else {
          await restoreInvite(claimed);
          throw error;
        }
      }
    }
    if (!membership) {
      await restoreInvite(claimed);
      throw ApiError.internal('Could not create the membership');
    }

    return {
      accepted: {
        workspace: { _id: String(workspace._id), name: workspace.name, slug: workspace.slug, type: workspace.type },
        membership: { role: membership.role, status: membership.status },
        alreadyMember: !created,
      },
      invite: claimed,
      workspace,
    };
  }
}

/** One invite per workspace and address: replace its link, role and expiry, or create it. */
async function upsertInvite(
  workspaceId: Types.ObjectId,
  input: CreateInviteInput,
  token: string,
  invitedBy: string,
): Promise<{ invite: IWorkspaceInvite; refreshed: boolean }> {
  const set = {
    role: input.role,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    invitedBy,
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await WorkspaceInviteModel.findOneAndUpdate(
        { workspaceId, email: input.email },
        { $set: set },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true, setDefaultsOnInsert: true },
      );
      if (!result.value) throw ApiError.internal('Could not save the invitation');
      return { invite: result.value, refreshed: Boolean(result.lastErrorObject?.updatedExisting) };
    } catch (error) {
      // Two simultaneous first invites for one address: the loser updates the winner's document.
      if (!isDuplicateKey(error) || attempt >= 2) throw error;
    }
  }
}

async function restoreInvite(invite: IWorkspaceInvite): Promise<void> {
  try {
    await WorkspaceInviteModel.create(invite.toObject());
  } catch (error) {
    console.error('[Invites] Could not restore an invitation after a failed accept:', (error as Error).message);
  }
}
