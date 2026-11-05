import axios from "axios";
import { apiClient } from "@/lib/api-client";
import { getApiBaseUrl } from "@/lib/env";
import type { DeckSettings, HostState } from "@/features/presentations/types";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** A deck's screen link as listed (the token itself is only in the create response). */
export interface ScreenTokenView {
  id: string;
  presentationId: string;
  label: string;
  prefix: string;
  last4: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export type CreatedScreenToken = ScreenTokenView & { token: string };

/** The deck's embed switch (`settings.embed.allowed`, off by default) and its join code. */
export const getEmbedInfo = async (presentationId: string) => {
  const deck = (await apiClient.get<ApiOk<{ joinCode: string; settings?: Partial<DeckSettings> }>>(`/presentations/${presentationId}`)).data.data;
  return { allowed: deck.settings?.embed?.allowed === true, joinCode: deck.joinCode };
};

/** Turns embedding on or off. Deck edits are refused while a session is live. */
export const setEmbedAllowed = async (presentationId: string, allowed: boolean) =>
  (
    await apiClient.patch<ApiOk<{ settings?: Partial<DeckSettings> }>>(`/presentations/${presentationId}`, {
      settings: { embed: { allowed } },
    })
  ).data.data.settings?.embed?.allowed === true;

// Screen links: the deck's owner, admins and editors (`deck:share`), through the signed-in client.

export const listScreenTokens = async (presentationId: string) =>
  (await apiClient.get<ApiOk<ScreenTokenView[]>>("/embeds/screen-tokens", { params: { presentationId } })).data.data;

export const createScreenToken = async (presentationId: string, label: string) =>
  (await apiClient.post<ApiOk<CreatedScreenToken>>("/embeds/screen-tokens", { presentationId, label })).data.data;

export const revokeScreenToken = async (id: string) =>
  (await apiClient.delete<ApiOk<{ id: string; revoked: true }>>(`/embeds/screen-tokens/${id}`)).data.data;

/**
 * A screen reads its stage with nothing but its token: no cookies, no bearer
 * token, no workspace header, no sign-in redirect on a 401 (the embed may sit
 * on any site). The token travels in a header, never in the API URL.
 */
const publicClient = axios.create({ baseURL: getApiBaseUrl(), withCredentials: false });

export const SCREEN_TOKEN_HEADER = "X-Screen-Token";

/** `GET /api/embeds/stage`: the host state's shape over a stage-safe deck. 404 dead link, 403 `EMBED_DISABLED`. */
export const getScreenState = async (screenToken: string) =>
  (await publicClient.get<ApiOk<HostState>>("/embeds/stage", { headers: { [SCREEN_TOKEN_HEADER]: screenToken } })).data.data;
