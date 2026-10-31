import { HOME_PATH } from "@/lib/routes";
import type { WorkspaceList } from "../types";

/** Request header naming the workspace a request acts in (backend workspaceContext()). */
export const WORKSPACE_HEADER = "X-Workspace-Id";

/** The persisted part of the workspace store: whose selection it is, and which workspace. */
export interface WorkspaceSelection {
  userId: string | null;
  currentWorkspaceId: string | null;
}

/**
 * The workspace to act in once the list is known: the current selection if it
 * is still one of the user's workspaces, else the server's default, else the
 * first workspace listed.
 */
export function reconcileSelection(selectedId: string | null, list: WorkspaceList): string | null {
  const ids = new Set(list.workspaces.map((workspace) => workspace._id));
  if (selectedId && ids.has(selectedId)) return selectedId;
  if (ids.has(list.defaultWorkspaceId)) return list.defaultWorkspaceId;
  return list.workspaces[0]?._id ?? null;
}

/**
 * The X-Workspace-Id value to send, or null to let the server use the default
 * workspace. A selection left behind by another account in this browser is
 * never sent.
 */
export function workspaceHeaderValue(selection: WorkspaceSelection, authUserId: string | null | undefined): string | null {
  if (!authUserId || selection.userId !== authUserId) return null;
  return selection.currentWorkspaceId;
}

/**
 * Where to land after switching workspace. Settings pages exist in every
 * workspace, so they reload in place; any other page may show content of the
 * previous workspace, so Home is the safe target.
 */
export function pathAfterSwitch(pathname: string | null): string {
  if (pathname && (pathname === "/settings" || pathname.startsWith("/settings/"))) return pathname;
  return HOME_PATH;
}
