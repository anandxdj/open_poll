import { audit } from '../../common/audit/audit';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import { resetUnverifiedAccount, startSession } from '../auth/auth.service';
import { identityFilter, linkIdentity } from '../auth/identities';
import { syncSeatsAfterMembershipChange } from '../billing/seatSync';
import { assertSeats, countActiveMembers } from '../workspaces/members.service';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import type { ISsoConnection, SsoRole } from './ssoConnection.model';

/** Codes the login page turns into copy (`/login?error=<code>`). */
export type SsoErrorCode =
  | 'sso_failed'
  | 'sso_expired'
  | 'sso_domain'
  | 'sso_no_account'
  | 'sso_suspended'
  | 'sso_seats'
  | 'sso_disabled';

/** A sign-in that cannot finish, with the code shown to the person. */
export class SsoLoginError extends Error {
  constructor(public readonly code: SsoErrorCode, message = code) {
    super(message);
    this.name = 'SsoLoginError';
  }
}

export interface SsoIdentity {
  subject: string;
  email: string;
  name: string;
  groups: string[];
}

/** The role a new member gets: the first IdP group with a mapping, else the connection's default. */
export const roleForGroups = (connection: Pick<ISsoConnection, 'groupRoles' | 'defaultRole'>, groups: string[]): SsoRole => {
  const lower = new Set(groups.map((g) => g.toLowerCase()));
  return connection.groupRoles.find((mapping) => lower.has(mapping.group.toLowerCase()))?.role ?? connection.defaultRole;
};

/** The IdP may only vouch for addresses in domains the workspace proved it owns. */
export const assertDomainVerified = (connection: Pick<ISsoConnection, 'domains'>, email: string) => {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!connection.domains.some((d) => d.domain === domain && d.verifiedAt)) throw new SsoLoginError('sso_domain');
};

/**
 * Signs a person in through a workspace's connection: finds them by this
 * connection's identity or their email (linking it), else creates the account
 * just in time; makes sure they are an active member (new members get the
 * role their IdP groups map to, within the plan's seats); starts a session.
 */
export async function completeSsoLogin(connection: ISsoConnection, identity: SsoIdentity) {
  if (!connection.enabled) throw new SsoLoginError('sso_disabled');
  assertDomainVerified(connection, identity.email);
  const workspace = await WorkspaceModel.findOne({ _id: connection.workspaceId, deletedAt: null });
  if (!workspace) throw new SsoLoginError('sso_failed');

  const link = {
    provider: connection.type === 'saml' ? ('saml' as const) : ('oidc_ws' as const),
    subject: identity.subject,
    connectionId: connection._id,
  };
  let user = (await UserModel.findOne(identityFilter(link))) ?? (await UserModel.findOne({ email: identity.email }));
  if (user?.deletedAt) throw new SsoLoginError('sso_no_account');
  let membership = user ? await WorkspaceMemberModel.findOne({ workspaceId: workspace._id, userId: user._id }) : null;
  if (membership?.status === 'suspended' || user?.active === false) throw new SsoLoginError('sso_suspended');
  if (!membership && !connection.jit) throw new SsoLoginError('sso_no_account');

  const created = !user;
  if (!user) {
    user = new UserModel({ email: identity.email, name: identity.name, isVerified: true, role: 'user', identities: [] });
  } else if (!user.isVerified) {
    // Someone may have pre-registered this address; the IdP proves who owns it now.
    resetUnverifiedAccount(user);
  }
  linkIdentity(user, link);
  user.isVerified = true;
  user.lastLogin = new Date();
  // Coming back during the account's deletion grace period cancels it, as any sign-in does.

  let joined = false;
  if (!membership) {
    try {
      assertSeats(workspace, (await countActiveMembers(workspace._id)) + 1);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PLAN_LIMIT_REACHED') throw new SsoLoginError('sso_seats');
      throw error;
    }
    user.defaultWorkspaceId = workspace._id;
    await user.save();
    membership = await WorkspaceMemberModel.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: roleForGroups(connection, identity.groups),
      status: 'active',
      source: 'sso_jit',
    });
    syncSeatsAfterMembershipChange(workspace);
    joined = true;
  } else if (membership.status === 'invited') {
    membership.status = 'active';
    await membership.save();
  }

  const session = await startSession(user);
  connection.lastLoginAt = new Date();
  await connection.save();
  void audit(
    { actorType: 'user', actorId: user._id, workspace },
    'sso.login',
    { type: 'sso_connection', id: connection._id },
    { email: user.email, createdUser: created, joined, role: membership.role },
  );
  return { user, ...session };
}
