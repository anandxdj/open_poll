import { z } from 'zod';

const workspaceName = z.string().trim().min(1, 'Name is required').max(120, 'Name is too long');

/** POST /api/workspaces: a new team workspace. The plan is never chosen here. */
export const createWorkspaceSchema = z.strictObject({
  name: workspaceName,
});

/**
 * PATCH /api/workspaces/:id. Only fields the workspace module owns; SSO,
 * embed and theme settings are added by the packages that enforce them.
 * Unknown keys (plan, ownerId, type, ...) are rejected, not ignored.
 */
export const updateWorkspaceSchema = z
  .strictObject({
    name: workspaceName.optional(),
    settings: z
      .strictObject({
        /** Days session data is kept; null = as long as the plan allows. Capped by the plan's retentionDays. */
        retentionDays: z.number().int().min(1).nullable().optional(),
        /** Sign-ins for the workspace's verified SSO domains must use SSO (W3-D, `workspace:sso`). */
        requireSso: z.boolean().optional(),
        /** Theme new decks start with (W3-A, `workspace:brand`); null = the built-in look. */
        defaultTheme: z
          .strictObject({
            presetId: z.string().min(1).max(40),
            brandKitId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id').nullable().default(null),
          })
          .nullable()
          .optional(),
      })
      .optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.settings?.retentionDays !== undefined ||
      body.settings?.defaultTheme !== undefined ||
      body.settings?.requireSso !== undefined,
    { message: 'Nothing to update' },
  );

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
