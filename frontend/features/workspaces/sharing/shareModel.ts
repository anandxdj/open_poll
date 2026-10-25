import { roleRank, type ShareRole } from "../members/roles";
import type { Member } from "../members/types";
import type { ShareEntry, ShareGroup, ShareInput, SharePrincipalType } from "./types";

/** The request body for PUT /api/shares from the dialog's working list. */
export const toInputs = (entries: readonly ShareEntry[]): ShareInput[] =>
  entries.map(({ principalType, principalId, role }) => ({ principalType, principalId, role }));

const keyOf = (entry: Pick<ShareEntry, "principalType" | "principalId">) => `${entry.principalType}:${entry.principalId}`;

/** Whether two lists grant the same roles to the same principals. */
export function sameShares(a: readonly ShareEntry[], b: readonly ShareEntry[]): boolean {
  if (a.length !== b.length) return false;
  const roles = new Map(a.map((entry) => [keyOf(entry), entry.role]));
  return b.every((entry) => roles.get(keyOf(entry)) === entry.role);
}

export const changeShareRole = (entries: readonly ShareEntry[], target: ShareEntry, role: ShareRole): ShareEntry[] =>
  entries.map((entry) => (keyOf(entry) === keyOf(target) ? { ...entry, role } : entry));

export const removeShare = (entries: readonly ShareEntry[], target: ShareEntry): ShareEntry[] =>
  entries.filter((entry) => keyOf(entry) !== keyOf(target));

export interface Candidate {
  principalType: SharePrincipalType;
  principalId: string;
  name: string;
  email: string | null;
  workspaceRole: ShareEntry["workspaceRole"];
}

/** Active members and groups not yet on the list, members first, by name. The caller themself is left out. */
export function candidatesFor(
  members: readonly Member[],
  groups: readonly ShareGroup[],
  entries: readonly ShareEntry[],
  selfId: string | null,
): Candidate[] {
  const taken = new Set(entries.map(keyOf));
  const people = members
    .filter((member) => member.status === "active" && member.userId !== selfId && !taken.has(`user:${member.userId}`))
    .map((member): Candidate => ({
      principalType: "user",
      principalId: member.userId,
      name: member.name,
      email: member.email,
      workspaceRole: member.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const teams = groups
    .filter((group) => !taken.has(`group:${group.id}`))
    .map((group): Candidate => ({ principalType: "group", principalId: group.id, name: group.name, email: null, workspaceRole: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...people, ...teams];
}

export const addShare = (entries: readonly ShareEntry[], candidate: Candidate, role: ShareRole): ShareEntry[] => [
  ...entries,
  { ...candidate, role },
];

/** A share that adds nothing: the member's workspace role already allows at least as much. */
export const isRedundant = (entry: Pick<ShareEntry, "role" | "workspaceRole">): boolean =>
  entry.workspaceRole !== null && roleRank(entry.workspaceRole) >= roleRank(entry.role);
