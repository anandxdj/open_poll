import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WorkspaceDetail, WorkspaceList, WorkspaceSummary } from "../types";
import { reconcileSelection, type WorkspaceSelection } from "./selection";

export type WorkspaceListStatus = "idle" | "loading" | "ready" | "error";

export interface WorkspaceState extends WorkspaceSelection {
  /** The signed-in user's workspaces (GET /api/workspaces). Not persisted. */
  workspaces: WorkspaceSummary[];
  listStatus: WorkspaceListStatus;
  /** Detail of the current workspace: role, permissions, entitlements. Not persisted. */
  current: WorkspaceDetail | null;
  /** Marks a list load for `userId` as started; false when one is already running for them. */
  beginListLoad: (userId: string) => boolean;
  /** Stores the list and keeps the selection if still valid, else falls back to the server default. */
  setList: (userId: string, list: WorkspaceList) => void;
  failListLoad: () => void;
  select: (workspaceId: string) => void;
  /** Stores the current workspace's detail and mirrors its name/plan/role into the list. */
  setCurrent: (detail: WorkspaceDetail) => void;
  /** Drops a selection the server refused; the next list load picks the default again. */
  clearSelection: () => void;
}

/**
 * The workspace the app acts in. The selection (and whose it is) survives
 * reloads in localStorage; `lib/api-client.ts` sends it as X-Workspace-Id.
 * This module must not import the API client (the client imports it).
 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      userId: null,
      currentWorkspaceId: null,
      workspaces: [],
      listStatus: "idle",
      current: null,

      beginListLoad: (userId) => {
        const state = get();
        if (state.listStatus === "loading" && state.userId === userId) return false;
        set(state.userId === userId ? { listStatus: "loading" } : { listStatus: "loading", userId, currentWorkspaceId: null, workspaces: [], current: null });
        return true;
      },

      setList: (userId, list) =>
        set((state) => {
          const selected = state.userId === userId ? state.currentWorkspaceId : null;
          const currentWorkspaceId = reconcileSelection(selected, list);
          return {
            userId,
            currentWorkspaceId,
            workspaces: list.workspaces,
            listStatus: "ready",
            current: state.current?.workspace._id === currentWorkspaceId ? state.current : null,
          };
        }),

      failListLoad: () => set({ listStatus: "error" }),

      select: (workspaceId) =>
        set((state) => ({
          currentWorkspaceId: workspaceId,
          current: state.current?.workspace._id === workspaceId ? state.current : null,
        })),

      setCurrent: (detail) =>
        set((state) => ({
          current: detail,
          workspaces: state.workspaces.map((row) =>
            row._id === detail.workspace._id
              ? { ...row, name: detail.workspace.name, plan: detail.workspace.plan, role: detail.membership.role }
              : row,
          ),
        })),

      clearSelection: () => set({ currentWorkspaceId: null, current: null, listStatus: "idle" }),
    }),
    {
      name: "openpoll_workspace",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): WorkspaceSelection => ({ userId: state.userId, currentWorkspaceId: state.currentWorkspaceId }),
    },
  ),
);
