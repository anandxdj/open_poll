"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import { getCapabilities, getWorkspace, listWorkspaces, switchWorkspace } from "../api/workspaces.api";
import { pathAfterSwitch } from "../store/selection";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { Capabilities } from "../types";

/** Loads the user's workspaces into the store; concurrent callers share one request. */
export async function loadWorkspaces(userId: string): Promise<void> {
  if (!useWorkspaceStore.getState().beginListLoad(userId)) return;
  try {
    const list = await listWorkspaces();
    useWorkspaceStore.getState().setList(userId, list);
  } catch {
    useWorkspaceStore.getState().failListLoad();
  }
}

let detailInFlight: string | null = null;

/**
 * Loads the current workspace's detail. Resolves false when it failed; a
 * selection the server refuses (403) is dropped so the list falls back to the
 * default workspace.
 */
async function loadCurrentWorkspace(workspaceId: string): Promise<boolean> {
  if (detailInFlight === workspaceId) return true;
  detailInFlight = workspaceId;
  try {
    const detail = await getWorkspace(workspaceId);
    if (useWorkspaceStore.getState().currentWorkspaceId === workspaceId) useWorkspaceStore.getState().setCurrent(detail);
    return true;
  } catch (error) {
    if (getApiErrorStatus(error) === 403 && useWorkspaceStore.getState().currentWorkspaceId === workspaceId) {
      useWorkspaceStore.getState().clearSelection();
      return true;
    }
    return false;
  } finally {
    detailInFlight = null;
  }
}

/** The signed-in user's workspaces and the selected one; loads them once per page load. */
export function useWorkspaces() {
  const authUserId = useAuthStore((state) => state.user?._id ?? null);
  const { userId, listStatus, workspaces, currentWorkspaceId } = useWorkspaceStore(
    useShallow((state) => ({
      userId: state.userId,
      listStatus: state.listStatus,
      workspaces: state.workspaces,
      currentWorkspaceId: state.currentWorkspaceId,
    })),
  );

  useEffect(() => {
    if (!authUserId) return;
    if (listStatus === "idle" || userId !== authUserId) void loadWorkspaces(authUserId);
  }, [authUserId, userId, listStatus]);

  const ready = listStatus === "ready" && userId === authUserId;
  const reload = useCallback(() => {
    if (authUserId) void loadWorkspaces(authUserId);
  }, [authUserId]);

  return {
    workspaces: ready ? workspaces : [],
    currentWorkspaceId: ready ? currentWorkspaceId : null,
    current: ready ? (workspaces.find((workspace) => workspace._id === currentWorkspaceId) ?? null) : null,
    status: listStatus,
    reload,
  };
}

/** Role, permissions and entitlements of the selected workspace (GET /api/workspaces/:id). */
export function useCurrentWorkspace() {
  const { currentWorkspaceId, status } = useWorkspaces();
  const current = useWorkspaceStore((state) => state.current);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const detail = current && current.workspace._id === currentWorkspaceId ? current : null;

  useEffect(() => {
    if (!currentWorkspaceId || detail) return;
    let cancelled = false;
    void loadCurrentWorkspace(currentWorkspaceId).then((ok) => {
      if (!cancelled) setFailedId(ok ? null : currentWorkspaceId);
    });
    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, detail, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    detail,
    failed: status === "error" || (!detail && failedId !== null && failedId === currentWorkspaceId),
    retry,
  };
}

let capabilitiesRequest: Promise<Capabilities> | null = null;

/** GET /api/capabilities, once per page load (they only change with a redeploy). */
export function useCapabilities(): Capabilities | null {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    capabilitiesRequest ??= getCapabilities().catch((error: unknown) => {
      capabilitiesRequest = null;
      throw error;
    });
    capabilitiesRequest.then(
      (value) => {
        if (!cancelled) setCapabilities(value);
      },
      () => {
        // Sections that depend on capabilities stay disabled without a reason.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return capabilities;
}

/**
 * Switches workspace: persists it as the default (also used by MCP and the
 * next sign-in), selects it, then reloads so every page refetches its data
 * in the new workspace.
 */
export function useSwitchWorkspace() {
  const pathname = usePathname();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const switchTo = useCallback(
    async (workspaceId: string) => {
      setSwitchingTo(workspaceId);
      try {
        await switchWorkspace(workspaceId);
        useWorkspaceStore.getState().select(workspaceId);
        window.location.assign(pathAfterSwitch(pathname));
      } catch (error) {
        setSwitchingTo(null);
        toast.error(getApiErrorMessage(error) ?? "Could not switch workspace");
      }
    },
    [pathname],
  );

  return { switchTo, switchingTo };
}
