import { apiClient } from "@/lib/api-client";
import type { BrandKit, BrandKitInput, DeckThemeRef, ThemeCatalog } from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

export const getThemeCatalog = async () => (await apiClient.get<ApiOk<ThemeCatalog>>("/themes/presets")).data.data;

export const listBrandKits = async () => (await apiClient.get<ApiOk<BrandKit[]>>("/brand-kits")).data.data;

export const createBrandKit = async (input: BrandKitInput) =>
  (await apiClient.post<ApiOk<BrandKit>>("/brand-kits", input)).data.data;

export const updateBrandKit = async (id: string, input: Partial<BrandKitInput>) =>
  (await apiClient.patch<ApiOk<BrandKit>>(`/brand-kits/${id}`, input)).data.data;

export const deleteBrandKit = async (id: string) => {
  await apiClient.delete(`/brand-kits/${id}`);
};

/** Saves a deck's theme on its own (the builder's other fields keep their own save). */
export const saveDeckTheme = async (presentationId: string, theme: Partial<DeckThemeRef>) =>
  (await apiClient.patch<ApiOk<{ theme: DeckThemeRef }>>(`/presentations/${presentationId}`, { theme })).data.data.theme;
