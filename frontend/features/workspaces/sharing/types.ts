import type { WorkspaceRole } from "../types";
import type { ShareRole } from "../members/roles";

/** Shapes of GET|PUT /api/shares (backend/docs/wiki/modules/members-sharing.md). */

export type ShareResourceType = "presentation" | "folder";
export type SharePrincipalType = "user" | "group";

export interface ShareEntry {
  principalType: SharePrincipalType;
  principalId: string;
  role: ShareRole;
  name: string;
  email: string | null;
  /** Users only: their role in the workspace (a share can raise it, never lower it). */
  workspaceRole: WorkspaceRole | null;
}

export interface ShareGroup {
  id: string;
  name: string;
  memberCount: number;
}

export interface ShareList {
  resource: { type: ShareResourceType; id: string; title: string };
  shares: ShareEntry[];
  groups: ShareGroup[];
}

export interface ShareInput {
  principalType: SharePrincipalType;
  principalId: string;
  role: ShareRole;
}
