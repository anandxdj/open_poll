import { ROLE_NAMES, type WorkspaceRole } from "../types";
import type { InviteRole, Member } from "./types";

export const ROLE_ORDER: readonly WorkspaceRole[] = ["owner", "admin", "editor", "presenter", "viewer"];

const RANK: Record<WorkspaceRole, number> = { owner: 5, admin: 4, editor: 3, presenter: 2, viewer: 1 };

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Everything, including billing and ownership.",
  admin: "Manage members, settings and everything below.",
  editor: "Create, edit, present and share decks and polls.",
  presenter: "Present decks and export their results; no editing.",
  viewer: "View decks and results.",
};

/** Roles an invitation may carry (owners are made by role change or ownership transfer). */
export const INVITE_ROLES: readonly InviteRole[] = ["admin", "editor", "presenter", "viewer"];

/** Roles a share may grant on one deck or folder. */
export const SHARE_ROLES = ["editor", "presenter", "viewer"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export const roleRank = (role: WorkspaceRole) => RANK[role];

/**
 * Roles `actor` may assign (mirrors the backend rank rules): up to their own
 * rank, and only owners hand out the owner role.
 */
export function assignableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  return ROLE_ORDER.filter((role) => RANK[role] <= RANK[actor] && (role !== "owner" || actor === "owner"));
}

/** Roles `actor` may put in an invitation. */
export function invitableRoles(actor: WorkspaceRole): InviteRole[] {
  return INVITE_ROLES.filter((role) => RANK[role] <= RANK[actor]);
}

/** Whether `actor` may change or remove `target` (the server enforces the same rules). */
export function canChangeMember(actor: WorkspaceRole, target: Pick<Member, "role" | "isPrimaryOwner">): boolean {
  if (target.role === "owner" && actor !== "owner") return false;
  return RANK[target.role] <= RANK[actor];
}

export const roleLabel = (role: WorkspaceRole) => ROLE_NAMES[role];

/** "3 of 5 seats used (1 pending)" or "3 members" when the plan has no seat limit. */
export function describeSeats({ used, pending, limit }: { used: number; pending: number; limit: number | null }): string {
  const pendingText = pending > 0 ? ` (${pending} pending)` : "";
  if (limit === null) return `${used} ${used === 1 ? "member" : "members"}${pendingText}`;
  return `${used} of ${limit} ${limit === 1 ? "seat" : "seats"} used${pendingText}`;
}

/** Whether another invitation fits (pending invites reserve a seat). */
export function hasFreeSeat({ used, pending, limit }: { used: number; pending: number; limit: number | null }): boolean {
  return limit === null || used + pending < limit;
}
