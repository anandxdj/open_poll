import axios from "axios";

import { apiClient } from "@/lib/api-client";
import type { DeckCreatedResponse, DeckError, DeckOutlineResponse, DeckRequest } from "./types";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** Writing a deck can take a while (slides are written in batches, with repairs). */
const REQUEST_TIMEOUT_MS = 180_000;

/** The two calls of whole-deck authoring; tests pass a fake. */
export interface DeckApi {
  /** Step 1: an outline to review. Nothing is stored. */
  planOutline(request: DeckRequest, signal?: AbortSignal): Promise<DeckOutlineResponse>;
  /** Step 2: writes the slides and creates the draft deck. */
  createDeck(request: DeckRequest, signal?: AbortSignal): Promise<DeckCreatedResponse>;
}

const post = async <T>(request: DeckRequest, signal?: AbortSignal): Promise<T> =>
  (await apiClient.post<ApiOk<T>>("/ai/generate-deck", request, { timeout: REQUEST_TIMEOUT_MS, signal })).data.data;

export const deckApi: DeckApi = {
  planOutline: (request, signal) => post<DeckOutlineResponse>({ ...request, step: "outline" }, signal),
  createDeck: (request, signal) => post<DeckCreatedResponse>({ ...request, step: "deck" }, signal),
};

/** True when the request was cancelled by the user (nothing to report). */
export const isCancelled = (error: unknown) => axios.isCancel(error);

/** Maps a failed request to what the UI can say about it. */
export function toDeckError(error: unknown): DeckError {
  if (!axios.isAxiosError<{ message?: unknown; code?: unknown; details?: { max?: unknown } }>(error)) {
    return { kind: "unknown" };
  }
  const response = error.response;
  if (!response) return { kind: "network" };
  const { status, data } = response;
  const message = typeof data?.message === "string" ? data.message : undefined;
  const code = typeof data?.code === "string" ? data.code : undefined;
  if (code === "PLAN_LIMIT_REACHED") {
    const max = data?.details?.max;
    return { kind: "limit", message, ...(typeof max === "number" ? { max } : {}) };
  }
  if (status === 429) return { kind: "rate", message };
  if (code === "AI_DECK_EMPTY") return { kind: "empty", message };
  if (status === 502 || status === 504 || code === "AI_PROVIDER_FAILED") return { kind: "provider", message };
  if (status === 403) return { kind: "forbidden", message };
  if (status === 400) return { kind: "invalid", message };
  return { kind: "unknown", message };
}
