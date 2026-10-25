import apiClient from "@/lib/api-client";
import type { WorkspaceRole } from "../../types";
import type { CreatedInvite, Invite, InviteRole, Member, MemberList, MemberStatus } from "../types";

type Envelope<T> = { data: T };

const base = (workspaceId: string) => `/workspaces/${workspaceId}`;

export async function listMembers(workspaceId: string) {
  const res = await apiClient.get<Envelope<MemberList>>(`${base(workspaceId)}/members`);
  return res.data.data;
}

export async function updateMember(
  workspaceId: string,
  userId: string,
  update: { role?: WorkspaceRole; status?: Exclude<MemberStatus, "invited"> },
) {
  const res = await apiClient.patch<Envelope<{ member: Member }>>(`${base(workspaceId)}/members/${userId}`, update);
  return res.data.data.member;
}

/** Removes a member, or leaves the workspace when `userId` is the caller. */
export async function removeMember(workspaceId: string, userId: string) {
  await apiClient.delete(`${base(workspaceId)}/members/${userId}`);
}

export async function transferOwnership(workspaceId: string, userId: string) {
  const res = await apiClient.post<Envelope<{ member: Member }>>(`${base(workspaceId)}/members/${userId}/transfer-ownership`);
  return res.data.data.member;
}

export async function listInvites(workspaceId: string) {
  const res = await apiClient.get<Envelope<{ invites: Invite[] }>>(`${base(workspaceId)}/invites`);
  return res.data.data.invites;
}

export async function createInvite(workspaceId: string, input: { email: string; role: InviteRole }) {
  const res = await apiClient.post<Envelope<CreatedInvite>>(`${base(workspaceId)}/invites`, input);
  return res.data.data;
}

export async function revokeInvite(workspaceId: string, inviteId: string) {
  await apiClient.delete(`${base(workspaceId)}/invites/${inviteId}`);
}
