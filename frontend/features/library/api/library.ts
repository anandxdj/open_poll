import { apiClient } from "@/lib/api-client";
import { libraryRequestParams } from "../query";
import type { LibraryCard, LibraryFilters, LibraryPage } from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

export const fetchLibraryPage = async (filters: LibraryFilters, cursor: string | null = null) =>
  (await apiClient.get<ApiOk<LibraryPage>>("/library", { params: libraryRequestParams(filters, cursor) })).data.data;

export interface ConvertedPoll {
  /** False when the poll had been converted before and that deck was returned. */
  created: boolean;
  presentation: { _id: string; title: string };
}

/** "Convert to presentation": copies the poll's questions into an audience-paced deck. */
export const convertPollToPresentation = async (pollId: string, options: { force?: boolean } = {}) =>
  (
    await apiClient.post<ApiOk<ConvertedPoll>>(`/library/convert/poll/${pollId}`, undefined, {
      params: options.force ? { force: "true" } : undefined,
    })
  ).data.data;

export const deleteLibraryItem = async (card: Pick<LibraryCard, "entityType" | "id">) => {
  await apiClient.delete(card.entityType === "poll" ? `/polls/${card.id}` : `/presentations/${card.id}`);
};

export const closePoll = async (pollId: string) => {
  await apiClient.post(`/polls/${pollId}/close`);
};
