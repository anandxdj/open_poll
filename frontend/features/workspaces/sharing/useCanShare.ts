import { useWorkspaceStore } from "../store/useWorkspaceStore";

/** Roles whose members hold `deck:share` (backend ACTION_MATRIX). */
const SHARING_ROLES = new Set(["owner", "admin", "editor"]);

/**
 * Whether the selected workspace is a team workspace where the user may share
 * decks. Reads the workspace list the dashboard already loaded (no request of
 * its own, so a card per deck costs nothing); false until it is known.
 */
export function useCanShareDecks(): boolean {
  return useWorkspaceStore((state) => {
    const current = state.workspaces.find((workspace) => workspace._id === state.currentWorkspaceId);
    return Boolean(current && current.type === "team" && SHARING_ROLES.has(current.role));
  });
}
