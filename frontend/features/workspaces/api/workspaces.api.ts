import apiClient from "@/lib/api-client";
import type { Capabilities, WorkspaceDetail, WorkspaceList, WorkspaceUpdate } from "../types";

type Envelope<T> = { data: T };

export async function listWorkspaces() {
  const res = await apiClient.get<Envelope<WorkspaceList>>("/workspaces");
  return res.data.data;
}

/** Creates a team workspace owned by the caller (plan-gated: 403 PLAN_LIMIT_REACHED). */
export async function createWorkspace(name: string) {
  const res = await apiClient.post<Envelope<WorkspaceDetail>>("/workspaces", { name });
  return res.data.data;
}

export async function getWorkspace(workspaceId: string) {
  const res = await apiClient.get<Envelope<WorkspaceDetail>>(`/workspaces/${workspaceId}`);
  return res.data.data;
}

export async function updateWorkspace(workspaceId: string, update: WorkspaceUpdate) {
  const res = await apiClient.patch<Envelope<WorkspaceDetail>>(`/workspaces/${workspaceId}`, update);
  return res.data.data;
}

/** Makes the workspace the user's default (requests without X-Workspace-Id, MCP, next sign-in). */
export async function switchWorkspace(workspaceId: string) {
  const res = await apiClient.post<Envelope<WorkspaceDetail>>(`/workspaces/${workspaceId}/switch`);
  return res.data.data;
}

export async function getCapabilities() {
  const res = await apiClient.get<Envelope<Capabilities>>("/capabilities");
  return res.data.data;
}
