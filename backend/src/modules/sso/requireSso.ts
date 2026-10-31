import type { Types } from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { SsoConnectionModel, type ISsoConnection } from './ssoConnection.model';

export const SSO_REQUIRED = 'SSO_REQUIRED';

const domainOf = (email: string) => email.split('@')[1]?.trim().toLowerCase() ?? '';

/** The enabled connection that has verified the email's domain, or null. */
export async function connectionForEmail(email: string): Promise<ISsoConnection | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  return SsoConnectionModel.findOne({
    enabled: true,
    domains: { $elemMatch: { domain, verifiedAt: { $ne: null } } },
  });
}

/**
 * 403 SSO_REQUIRED when the email's domain belongs to a workspace that signs
 * in through single sign-on only. The workspace's owner keeps the other
 * sign-in methods, so a broken IdP never locks everyone out.
 */
export async function assertSsoNotRequired(user: { _id: Types.ObjectId | string; email: string }) {
  const connection = await connectionForEmail(user.email);
  if (!connection) return;
  const workspace = await WorkspaceModel.findOne({ _id: connection.workspaceId, deletedAt: null }).select('settings ownerId').lean();
  if (!workspace?.settings?.requireSso || String(workspace.ownerId) === String(user._id)) return;
  throw new ApiError(403, 'Your organization signs in with single sign-on', SSO_REQUIRED, {
    connectionId: String(connection._id),
  });
}

/** Whether the workspace may require SSO: an enabled connection with a verified domain and a passed test sign-in. */
export async function canRequireSso(workspaceId: Types.ObjectId | string): Promise<boolean> {
  return Boolean(
    await SsoConnectionModel.exists({
      workspaceId,
      enabled: true,
      'domains.verifiedAt': { $ne: null },
      lastTest: { $ne: null },
    }),
  );
}
