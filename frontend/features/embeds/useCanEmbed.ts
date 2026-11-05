import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";

/** Roles that may turn embedding on (`deck:edit`) and hand out screen links (`deck:share`). */
const EMBED_ROLES = new Set(["owner", "admin", "editor"]);

/**
 * Whether the user may manage a deck's embeds in the selected workspace, any
 * type (a personal workspace's owner too). Reads the workspace list the
 * dashboard already loaded; false until it is known. The API decides anyway.
 */
export function useCanEmbedDecks(): boolean {
  return useWorkspaceStore((state) => {
    const current = state.workspaces.find((workspace) => workspace._id === state.currentWorkspaceId);
    return Boolean(current && EMBED_ROLES.has(current.role));
  });
}
