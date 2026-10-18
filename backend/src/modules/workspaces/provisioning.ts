import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { UserModel } from '../auth/auth.model';
import type { WorkspaceRole } from '../../common/tenancy/roles';
import { WorkspaceModel, type IWorkspace } from './workspace.model';
import { WorkspaceMemberModel, type IWorkspaceMember, type MemberSource } from './workspaceMember.model';

export interface ProvisionableUser {
  _id: Types.ObjectId | string;
  name: string;
  defaultWorkspaceId?: Types.ObjectId | string | null;
}

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/** Lower-case ASCII words joined by hyphens, at most 40 characters. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** A slug for a new workspace; the random suffix makes collisions negligible (callers retry on 11000). */
export function generateWorkspaceSlug(name: string): string {
  return `${slugify(name) || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

/**
 * Creates the membership if missing and returns it. An existing membership is
 * returned unchanged (role and status are never downgraded here).
 */
export async function ensureMembership(
  workspaceId: Types.ObjectId,
  userId: Types.ObjectId | string,
  role: WorkspaceRole,
  source: MemberSource = 'manual',
): Promise<IWorkspaceMember> {
  const filter = { workspaceId, userId };
  try {
    const member = await WorkspaceMemberModel.findOneAndUpdate(
      filter,
      { $setOnInsert: { role, status: 'active', source } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    if (member) return member;
  } catch (error) {
    // Two concurrent upserts: the loser re-reads the winner's document.
    if (!isDuplicateKey(error)) throw error;
  }
  const member = await WorkspaceMemberModel.findOne(filter);
  if (!member) throw new Error(`Membership ${String(userId)}@${String(workspaceId)} vanished during upsert`);
  return member;
}

/**
 * Returns the user's personal workspace and owner membership, creating them on
 * first use, and makes it the default workspace when the user has none.
 *
 * Safe under concurrency: the partial unique index {ownerId, type:'personal'}
 * (migration 001) lets exactly one insert win; the others re-read it.
 */
export async function ensurePersonalWorkspace(
  user: ProvisionableUser,
): Promise<{ workspace: IWorkspace; membership: IWorkspaceMember }> {
  const ownerId = user._id;
  let workspace = await WorkspaceModel.findOne({ ownerId, type: 'personal' });

  for (let attempt = 0; !workspace && attempt < 3; attempt += 1) {
    try {
      workspace = await WorkspaceModel.create({
        name: `${user.name}'s workspace`.slice(0, 120),
        slug: generateWorkspaceSlug(user.name),
        type: 'personal',
        ownerId,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another request provisioned it first, or the random slug collided (retry).
      workspace = await WorkspaceModel.findOne({ ownerId, type: 'personal' });
    }
  }
  if (!workspace) throw new Error(`Could not provision a personal workspace for user ${String(ownerId)}`);

  const membership = await ensureMembership(workspace._id, ownerId, 'owner');

  if (!user.defaultWorkspaceId) {
    // Conditional, so a concurrent workspace switch is never overwritten.
    await UserModel.updateOne({ _id: ownerId, defaultWorkspaceId: null }, { $set: { defaultWorkspaceId: workspace._id } });
  }
  return { workspace, membership };
}
