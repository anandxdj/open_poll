import axios from "axios";
import { apiClient } from "@/lib/api-client";
import { getApiBaseUrl } from "@/lib/env";
import type { CustomDomain, DomainsOverview, ResolvedDomain } from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

const base = (workspaceId: string) => `/workspaces/${workspaceId}/domains`;

export const listDomains = async (workspaceId: string) => (await apiClient.get<ApiOk<DomainsOverview>>(base(workspaceId))).data.data;

export const addDomain = async (workspaceId: string, hostname: string) =>
  (await apiClient.post<ApiOk<CustomDomain>>(base(workspaceId), { hostname })).data.data;

export const verifyDomain = async (workspaceId: string, id: string) =>
  (await apiClient.post<ApiOk<CustomDomain>>(`${base(workspaceId)}/${id}/verify`)).data.data;

export const removeDomain = async (workspaceId: string, id: string) => {
  await apiClient.delete(`${base(workspaceId)}/${id}`);
};

/** No credentials: anyone on the custom domain asks. Null for hosts that are not active domains. */
export async function resolveDomain(host: string): Promise<ResolvedDomain | null> {
  try {
    return (await axios.get<ApiOk<ResolvedDomain>>(`${getApiBaseUrl()}/public/domains/resolve`, { params: { host } })).data.data;
  } catch {
    return null;
  }
}
