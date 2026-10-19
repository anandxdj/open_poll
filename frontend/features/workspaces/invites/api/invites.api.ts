import apiClient from "@/lib/api-client";
import type { AcceptedInvite, InvitePreview } from "../../members/types";

type Envelope<T> = { data: T };

/** Public: what an invitation link is for (the address comes back masked). */
export async function previewInvite(token: string) {
  const res = await apiClient.get<Envelope<InvitePreview>>(`/invites/${encodeURIComponent(token)}`);
  return res.data.data;
}

/** Joins the signed-in user to the workspace; their verified email must be the invited one. */
export async function acceptInvite(token: string) {
  const res = await apiClient.post<Envelope<AcceptedInvite>>(`/invites/${encodeURIComponent(token)}/accept`);
  return res.data.data;
}
