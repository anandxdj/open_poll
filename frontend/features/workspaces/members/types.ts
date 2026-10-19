import type { WorkspaceRole } from "../types";

/** Shapes of the members and invites APIs (backend/docs/wiki/modules/members-sharing.md). */

export type MemberStatus = "active" | "invited" | "suspended";
export type MemberSource = "manual" | "scim" | "sso_jit";

export interface Member {
  userId: string;
  name: string;
  email: string;
  picture: string | null;
  role: WorkspaceRole;
  status: MemberStatus;
  source: MemberSource;
  joinedAt: string;
  /** `workspace.ownerId`: the billing contact; changes only by an ownership transfer. */
  isPrimaryOwner: boolean;
}

export interface MemberList {
  members: Member[];
  seats: { used: number; pending: number; limit: number | null };
  /** The caller may change roles, remove members and invite. */
  canManage: boolean;
}

export interface Invite {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string } | null;
}

export interface CreatedInvite {
  invite: Invite;
  /** The single-use link; only returned on create/refresh. */
  inviteUrl: string;
  emailSent: boolean;
  refreshed: boolean;
}

export type InviteRole = Exclude<WorkspaceRole, "owner">;

export interface InvitePreview {
  workspaceName: string;
  role: WorkspaceRole;
  /** Masked, e.g. `a**@example.com`. */
  email: string;
  inviterName: string | null;
  expiresAt: string;
}

export interface AcceptedInvite {
  workspace: { _id: string; name: string; slug: string; type: "personal" | "team" };
  membership: { role: WorkspaceRole; status: MemberStatus };
  alreadyMember: boolean;
}
