import { z } from 'zod';
import { MAX_FOLDER_NAME } from './folder.model';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** Items one move request may carry (a page of library cards and then some). */
export const MAX_MOVE_ITEMS = 100;

const folderName = z
  .string()
  .trim()
  .min(1, 'Give the folder a name')
  .max(MAX_FOLDER_NAME, `Use at most ${MAX_FOLDER_NAME} characters`);

/** `POST /api/folders`. */
export const createFolderSchema = z.object({ name: folderName }).strict();

/** `PATCH /api/folders/:id`. */
export const renameFolderSchema = z.object({ name: folderName }).strict();

/**
 * `POST /api/folders/move`: put decks and polls in a folder (`folderId`), or
 * back at the top level (`folderId: null`).
 */
export const moveItemsSchema = z
  .object({
    folderId: objectId.nullable(),
    items: z
      .array(z.object({ entityType: z.enum(['presentation', 'poll']), id: objectId }).strict())
      .min(1, 'Pick at least one item')
      .max(MAX_MOVE_ITEMS, `Move at most ${MAX_MOVE_ITEMS} items at a time`),
  })
  .strict();

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type RenameFolderInput = z.infer<typeof renameFolderSchema>;
export type MoveItemsInput = z.infer<typeof moveItemsSchema>;
