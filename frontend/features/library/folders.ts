import { apiClient } from "@/lib/api-client";
import type { LibraryEntityType } from "./types";

// Library folders (`/api/folders`, backend `modules/folders`): one level of
// folders per workspace holding decks and polls. Wire types and calls.

type ApiOk<T> = { success: boolean; message: string; data: T };

export interface LibraryFolder {
  id: string;
  name: string;
  parentId: null;
  counts: { presentations: number; polls: number };
  createdAt: string;
  updatedAt: string;
}

/** Backend limit on a folder name. */
export const MAX_FOLDER_NAME = 60;

export const folderItemCount = (folder: Pick<LibraryFolder, "counts">) => folder.counts.presentations + folder.counts.polls;

export const listFolders = async () => (await apiClient.get<ApiOk<{ folders: LibraryFolder[] }>>("/folders")).data.data.folders;

export const createFolder = async (name: string) =>
  (await apiClient.post<ApiOk<{ folder: LibraryFolder }>>("/folders", { name })).data.data.folder;

export const renameFolder = async (id: string, name: string) =>
  (await apiClient.patch<ApiOk<{ folder: LibraryFolder }>>(`/folders/${id}`, { name })).data.data.folder;

export interface DeletedFolder {
  folder: { id: string; name: string };
  moved: { presentations: number; polls: number };
  sharesRemoved: number;
}

/** Deletes the folder; what was in it goes back to the top level. */
export const deleteFolder = async (id: string) => (await apiClient.delete<ApiOk<DeletedFolder>>(`/folders/${id}`)).data.data;

/** Files items into `folderId`, or back at the top level with `null`. */
export const moveToFolder = async (folderId: string | null, items: { entityType: LibraryEntityType; id: string }[]) =>
  (
    await apiClient.post<ApiOk<{ folderId: string | null; moved: { presentations: number; polls: number } }>>("/folders/move", {
      folderId,
      items,
    })
  ).data.data;

/** Folders sorted the way the API returns them (name, case-insensitive). */
export const sortFolders = (folders: LibraryFolder[]) =>
  [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
