import { z } from 'zod';
import { SHARE_ROLES, WORKSPACE_ROLES } from '../../common/tenancy/roles';
import { SHARE_PRINCIPAL_TYPES, SHARE_RESOURCE_TYPES } from './resourceShare.model';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** Roles an invitation may carry: owners are made through an explicit ownership transfer or role change. */
export const INVITE_ROLES = WORKSPACE_ROLES.filter((role) => role !== 'owner') as ['admin', 'editor', 'presenter', 'viewer'];

/** PATCH /api/workspaces/:workspaceId/members/:userId */
export const updateMemberSchema = z
  .strictObject({
    role: z.enum(WORKSPACE_ROLES).optional(),
    /** `invited` is not settable: invitations live in WorkspaceInvite. */
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((body) => body.role !== undefined || body.status !== undefined, { message: 'Nothing to update' });

/** POST /api/workspaces/:workspaceId/invites */
export const createInviteSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
  role: z.enum(INVITE_ROLES),
});

/** GET|PUT /api/shares?resourceType&resourceId */
export const shareQuerySchema = z.object({
  resourceType: z.enum(SHARE_RESOURCE_TYPES),
  resourceId: objectId,
});

export const MAX_SHARES_PER_RESOURCE = 200;

/** PUT /api/shares: the complete set of grants on the resource (replaces the current one). */
export const putSharesSchema = z
  .strictObject({
    shares: z
      .array(
        z.strictObject({
          principalType: z.enum(SHARE_PRINCIPAL_TYPES),
          principalId: objectId,
          role: z.enum(SHARE_ROLES),
        }),
      )
      .max(MAX_SHARES_PER_RESOURCE),
  })
  .refine(
    (body) => new Set(body.shares.map((share) => `${share.principalType}:${share.principalId.toLowerCase()}`)).size === body.shares.length,
    { message: 'Each user or group may appear only once' },
  );

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type ShareQuery = z.infer<typeof shareQuerySchema>;
export type PutSharesInput = z.infer<typeof putSharesSchema>;
