"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";
import { getApiErrorMessage } from "@/lib/api-error";
import { listFolders, sortFolders, type LibraryFolder } from "../folders";

/** Roles that may create, rename, delete folders and file items (backend: deck:create / deck:share). */
const EDITING_ROLES = new Set(["owner", "admin", "editor"]);

/** Whether the user may organise the selected workspace's library; false until the workspace list is known. */
export function useCanOrganizeLibrary(): boolean {
  return useWorkspaceStore((state) => {
    const current = state.workspaces.find((workspace) => workspace._id === state.currentWorkspaceId);
    return Boolean(current && EDITING_ROLES.has(current.role));
  });
}

export interface FoldersState {
  folders: LibraryFolder[];
  loading: boolean;
  error: string | null;
  /** Refetches (counts change when items move). */
  refresh: () => void;
  /** Puts a created or renamed folder in the list. */
  upsert: (folder: LibraryFolder) => void;
  remove: (id: string) => void;
}

/** The selected workspace's folders, refetched when the workspace changes. */
export function useFolders(): FoldersState {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ key: string; folders: LibraryFolder[]; error: string | null } | null>(null);
  const key = `${workspaceId ?? ""}#${generation}`;

  useEffect(() => {
    let cancelled = false;
    listFolders().then(
      (folders) => {
        if (!cancelled) setState({ key, folders, error: null });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState((prev) => ({ key, folders: prev?.folders ?? [], error: getApiErrorMessage(error) ?? "Could not load folders." }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  const upsert = useCallback((folder: LibraryFolder) => {
    setState((prev) =>
      prev ? { ...prev, folders: sortFolders([...prev.folders.filter((item) => item.id !== folder.id), folder]) } : prev,
    );
  }, []);
  const remove = useCallback((id: string) => {
    setState((prev) => (prev ? { ...prev, folders: prev.folders.filter((folder) => folder.id !== id) } : prev));
  }, []);

  return {
    folders: state?.folders ?? [],
    loading: state === null,
    error: state?.error ?? null,
    refresh,
    upsert,
    remove,
  };
}
