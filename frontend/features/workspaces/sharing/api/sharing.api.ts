import apiClient from "@/lib/api-client";
import type { ShareInput, ShareList, ShareResourceType } from "../types";

type Envelope<T> = { data: T };

const query = (resourceType: ShareResourceType, resourceId: string) => ({ params: { resourceType, resourceId } });

export async function getShares(resourceType: ShareResourceType, resourceId: string) {
  const res = await apiClient.get<Envelope<ShareList>>("/shares", query(resourceType, resourceId));
  return res.data.data;
}

/** Replaces the complete set of grants on the deck or folder. */
export async function putShares(resourceType: ShareResourceType, resourceId: string, shares: ShareInput[]) {
  const res = await apiClient.put<Envelope<ShareList>>("/shares", { shares }, query(resourceType, resourceId));
  return res.data.data;
}
