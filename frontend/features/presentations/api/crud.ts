import axios from "axios";

import { apiClient } from "@/lib/api-client";
import type { Presentation, PresentationSlide } from "../types/deck";
import type { DeckThemeRef } from "@/features/themes/types";

type ApiOk<T> = { success: boolean; message: string; data: T };

export interface PresentationDraftInput {
  title: string;
  /** Slides may carry the `_id` of a stored slide: the API keeps it (unknown ids get a new one). */
  slides: PresentationSlide[];
  /** Create only: the new deck's theme; the builder sends at least the creator's light or dark. */
  theme?: Partial<DeckThemeRef>;
}

export const createPresentation = async (input: PresentationDraftInput) =>
  (await apiClient.post<ApiOk<Presentation>>("/presentations", input)).data.data;

export const listPresentations = async () =>
  (await apiClient.get<ApiOk<Presentation[]>>("/presentations")).data.data;

export const getPresentation = async (id: string) =>
  (await apiClient.get<ApiOk<Presentation>>(`/presentations/${id}`)).data.data;

/**
 * Saves deck fields. With `revision` (the one the editor loaded) the save is
 * refused with 409 `DECK_CHANGED` when someone else saved the title or slides
 * in between (`isDeckConflict`), instead of overwriting their edit.
 */
export const updatePresentation = async (
  id: string,
  input: Partial<PresentationDraftInput>,
  options: { revision?: number | null } = {},
) =>
  (
    await apiClient.patch<ApiOk<Presentation>>(`/presentations/${id}`, input, {
      headers: options.revision != null ? { "If-Match": `"${options.revision}"` } : undefined,
    })
  ).data.data;

/** A save refused because the deck changed since it was loaded (someone else saved). */
export const isDeckConflict = (err: unknown) =>
  axios.isAxiosError<{ code?: unknown }>(err) && err.response?.status === 409 && err.response.data?.code === "DECK_CHANGED";

export const deletePresentation = async (id: string) =>
  (await apiClient.delete<ApiOk<null>>(`/presentations/${id}`)).data;
