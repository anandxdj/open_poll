import { apiClient } from "@/lib/api-client";
import type { ScimToken, SsoConnection, SsoDiscovery, SsoOverview } from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

const base = (workspaceId: string) => `/workspaces/${workspaceId}/sso`;
const conn = (workspaceId: string, id: string) => `${base(workspaceId)}/connections/${id}`;

export const getSso = async (workspaceId: string) => (await apiClient.get<ApiOk<SsoOverview>>(base(workspaceId))).data.data;

export const createConnection = async (workspaceId: string, input: Record<string, unknown>) =>
  (await apiClient.post<ApiOk<SsoConnection>>(`${base(workspaceId)}/connections`, input)).data.data;

export const updateConnection = async (workspaceId: string, id: string, input: Record<string, unknown>) =>
  (await apiClient.patch<ApiOk<SsoConnection>>(conn(workspaceId, id), input)).data.data;

export const deleteConnection = async (workspaceId: string, id: string) => {
  await apiClient.delete(conn(workspaceId, id));
};

export const importMetadata = async (workspaceId: string, id: string, xml: string) =>
  (await apiClient.post<ApiOk<SsoConnection>>(`${conn(workspaceId, id)}/metadata`, { xml })).data.data;

export const addDomain = async (workspaceId: string, id: string, domain: string) =>
  (await apiClient.post<ApiOk<SsoConnection>>(`${conn(workspaceId, id)}/domains`, { domain })).data.data;

export const verifyDomain = async (workspaceId: string, id: string, domain: string) =>
  (await apiClient.post<ApiOk<SsoConnection>>(`${conn(workspaceId, id)}/domains/${encodeURIComponent(domain)}/verify`)).data.data;

export const removeDomain = async (workspaceId: string, id: string, domain: string) =>
  (await apiClient.delete<ApiOk<SsoConnection>>(`${conn(workspaceId, id)}/domains/${encodeURIComponent(domain)}`)).data.data;

/** A one-time link that runs a sign-in without touching any account. */
export const startTest = async (workspaceId: string, id: string) =>
  (await apiClient.post<ApiOk<{ url: string }>>(`${conn(workspaceId, id)}/test`)).data.data.url;

export const listScimTokens = async (workspaceId: string) =>
  (await apiClient.get<ApiOk<{ baseUrl: string; tokens: ScimToken[] }>>(`/workspaces/${workspaceId}/scim/tokens`)).data.data;

/** The token itself is only in this answer. */
export const createScimToken = async (workspaceId: string, label: string) =>
  (await apiClient.post<ApiOk<ScimToken & { token: string }>>(`/workspaces/${workspaceId}/scim/tokens`, { label })).data.data;

export const revokeScimToken = async (workspaceId: string, id: string) => {
  await apiClient.delete(`/workspaces/${workspaceId}/scim/tokens/${id}`);
};

/** The workspace connection for an email's domain, or null. */
export async function discoverSso(email: string): Promise<SsoDiscovery | null> {
  try {
    return (await apiClient.get<ApiOk<SsoDiscovery>>("/sso/discover", { params: { email } })).data.data;
  } catch {
    return null;
  }
}
