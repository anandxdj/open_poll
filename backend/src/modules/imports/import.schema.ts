import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const title = z.string().trim().min(1).max(120);

const key = z.string().trim().min(1).max(512);

/** `POST /api/imports`. Files are uploaded first (`POST /api/uploads/presign` with purpose `import_source`). */
export const createImportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pptx'), key, title: title.optional() }),
  z.object({ kind: z.literal('pdf'), key, title: title.optional() }),
  z
    .object({
      kind: z.literal('gslides'),
      /** A public share link (`https://docs.google.com/presentation/d/…`). */
      url: z.string().trim().min(1).max(2048).optional(),
      /** A file the user picked in Google Drive (only with Drive import enabled) and the picker's access token. */
      driveFileId: z.string().trim().min(10).max(128).optional(),
      driveAccessToken: z.string().trim().min(10).max(4096).optional(),
      title: title.optional(),
    })
    .superRefine((value, ctx) => {
      const drive = value.driveFileId !== undefined || value.driveAccessToken !== undefined;
      if (drive && (value.driveFileId === undefined || value.driveAccessToken === undefined)) {
        ctx.addIssue({ code: 'custom', path: ['driveAccessToken'], message: 'driveFileId and driveAccessToken go together' });
      } else if (drive === (value.url !== undefined)) {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'Send either a Google Slides link or a Drive file, not both or neither' });
      }
    }),
]);
export type CreateImportInput = z.infer<typeof createImportSchema>;

export const importIdSchema = objectId;

/** Text fields of `POST /api/imports/questions`. */
export const questionsFieldsSchema = z.object({
  /** `preview` parses and reports; `import` also writes the deck. */
  mode: z.enum(['preview', 'import']).default('import'),
  /** Append to this deck; without it a new deck is created. */
  presentationId: objectId.optional(),
  title: title.optional(),
});
export type QuestionsFields = z.infer<typeof questionsFieldsSchema>;
