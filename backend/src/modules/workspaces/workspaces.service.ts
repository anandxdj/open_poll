import { getEntitlements, assertLimit, type Entitlements } from '../../common/plans/entitlements';
import type { PlanId } from '../../common/plans/plans';
import { assertCan } from '../../common/tenancy/policy';
import { ACTIONS, roleAllows, type Action, type WorkspaceRole } from '../../common/tenancy/roles';
import { resolveWorkspaceContext, type WorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { assertThemeChoice } from '../themes/themes.service';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import { ensureMembership, generateWorkspaceSlug } from './provisioning';
import { WorkspaceModel, type IWorkspace, type IWorkspaceSettings, type WorkspaceType } from './workspace.model';
import { WorkspaceMemberModel, type IWorkspaceMember } from './workspaceMember.model';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from './workspaces.schema';

/** One row of GET /api/workspaces: a live workspace the user is an active member of. */
export interface WorkspaceSummary {
  _id: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  plan: PlanId;
  role: WorkspaceRole;
  isDefault: boolean;
}

/** GET/PATCH /api/workspaces/:id: the workspace as one of its members sees it. */
export interface WorkspaceDetail {
  workspace: {
    _id: string;
    name: string;
    slug: string;
    type: WorkspaceType;
    plan: PlanId;
    ownerId: string;
    settings: IWorkspaceSettings;
    createdAt: Date;
    updatedAt: Date;
  };
  membership: { role: WorkspaceRole; status: IWorkspaceMember['status'] };
  /** Every action the caller's role allows here (common/tenancy/roles.ts), for the UI to hide what it can't do. */
  permissions: Action[];
  /** Plan defaults ⊕ overrides (common/plans/entitlements.ts). */
  entitlements: Entitlements;
}

/** Someone acting on one workspace: a policy context with a resolved workspace. */
export interface WorkspaceActor extends WorkspaceContext {
  user: { id: string };
}

/**
 * Team workspaces a user may own while they are still limited to one seat
 * (see assertCanCreateTeamWorkspace). Billing (W3-C) tunes this gate.
 */
export const MAX_SINGLE_SEAT_TEAM_WORKSPACES = 1;

const SLUG_ATTEMPTS = 3;

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

export function toWorkspaceDetail({ workspace, membership }: WorkspaceContext): WorkspaceDetail {
  const entitlements = getEntitlements(workspace);
  const settings = workspace.settings;
  return {
    workspace: {
      _id: String(workspace._id),
      name: workspace.name,
      slug: workspace.slug,
      type: workspace.type,
      plan: entitlements.plan,
      ownerId: String(workspace.ownerId),
      settings: {
        retentionDays: settings?.retentionDays ?? null,
        requireSso: settings?.requireSso ?? false,
        allowedEmailDomains: settings?.allowedEmailDomains ?? [],
        embedAllowedOrigins: settings?.embedAllowedOrigins ?? [],
        defaultTheme: settings?.defaultTheme ?? null,
      },
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    membership: { role: membership.role, status: membership.status },
    permissions: ACTIONS.filter((action) => roleAllows(membership.role, action)),
    entitlements,
  };
}

/**
 * Plan gate for new team workspaces. A team workspace starts on the Free plan,
 * whose single seat only fits its owner; it gains members once its own plan
 * allows more seats (Team, Enterprise, purchased seats or an override). Each
 * user may therefore own at most MAX_SINGLE_SEAT_TEAM_WORKSPACES team
 * workspaces that are still single-seat; more need one of those upgraded.
 * Personal workspaces don't count.
 */
async function assertCanCreateTeamWorkspace(userId: string): Promise<void> {
  const owned = await WorkspaceModel.find({ ownerId: userId, type: 'team', deletedAt: null }).select(
    'name plan planOverrides billing',
  );
  const singleSeat = owned.filter((workspace) => {
    const { seats } = getEntitlements(workspace).limits;
    return seats !== null && seats <= 1;
  });
  if (singleSeat.length < MAX_SINGLE_SEAT_TEAM_WORKSPACES) return;

  const blocking = singleSeat[0]!;
  throw new ApiError(
    403,
    `Upgrade "${blocking.name}" to a plan with more seats before creating another team workspace`,
    'PLAN_LIMIT_REACHED',
    {
      limit: 'singleSeatTeamWorkspaces',
      max: MAX_SINGLE_SEAT_TEAM_WORKSPACES,
      plan: getEntitlements(blocking).plan,
      workspaceId: String(blocking._id),
    },
  );
}

async function insertTeamWorkspace(ownerId: string, name: string): Promise<IWorkspace> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await WorkspaceModel.create({ name, slug: generateWorkspaceSlug(name), type: 'team', ownerId });
    } catch (error) {
      // Only the random slug suffix can collide; retry with a fresh one.
      if (!isDuplicateKey(error) || attempt >= SLUG_ATTEMPTS) throw error;
    }
  }
}

export class WorkspaceService {
  /**
   * The user's workspaces and the effective default. Resolving the default
   * provisions the personal workspace and repairs a stale default, exactly as
   * a request without X-Workspace-Id would.
   */
  static async listForUser(userId: string): Promise<{ defaultWorkspaceId: string; workspaces: WorkspaceSummary[] }> {
    const { workspace: current } = await resolveWorkspaceContext(userId);
    const memberships = await WorkspaceMemberModel.find({ userId, status: 'active' }).select('workspaceId role');
    const roles = new Map(memberships.map((membership) => [String(membership.workspaceId), membership.role]));
    const workspaces = await WorkspaceModel.find({ _id: { $in: [...roles.keys()] }, deletedAt: null });
    const defaultWorkspaceId = String(current._id);

    const summaries = workspaces.map(
      (workspace): WorkspaceSummary => ({
        _id: String(workspace._id),
        name: workspace.name,
        slug: workspace.slug,
        type: workspace.type,
        plan: getEntitlements(workspace).plan,
        role: roles.get(String(workspace._id))!,
        isDefault: String(workspace._id) === defaultWorkspaceId,
      }),
    );
    // Personal workspace first, then team workspaces by name.
    summaries.sort(
      (a, b) => Number(b.type === 'personal') - Number(a.type === 'personal') || a.name.localeCompare(b.name),
    );
    return { defaultWorkspaceId, workspaces: summaries };
  }

  /** The workspace named in the path, for an active member; anything else is 403 WORKSPACE_FORBIDDEN. */
  static async resolve(userId: string, workspaceId: string): Promise<WorkspaceActor> {
    return { user: { id: userId }, ...(await resolveWorkspaceContext(userId, workspaceId)) };
  }

  /** Creates a team workspace owned by the user (who becomes its `owner` member). */
  static async create(userId: string, input: CreateWorkspaceInput): Promise<WorkspaceContext> {
    await assertCanCreateTeamWorkspace(userId);
    const workspace = await insertTeamWorkspace(userId, input.name);
    try {
      const membership = await ensureMembership(workspace._id, userId, 'owner');
      return { workspace, membership };
    } catch (error) {
      // A workspace nobody belongs to could never be reached or cleaned up.
      await WorkspaceModel.deleteOne({ _id: workspace._id });
      throw error;
    }
  }

  /** Renames the workspace or changes its settings; needs `workspace:manage`. Returns the updated context. */
  static async update(actor: WorkspaceActor, input: UpdateWorkspaceInput): Promise<WorkspaceContext> {
    assertCan(actor, 'workspace:manage');

    const $set: Record<string, unknown> = {};
    if (input.name !== undefined) $set.name = input.name;
    const retentionDays = input.settings?.retentionDays;
    if (retentionDays !== undefined) {
      if (retentionDays !== null) assertLimit(actor.workspace, 'retentionDays', retentionDays);
      $set['settings.retentionDays'] = retentionDays;
    }
    const defaultTheme = input.settings?.defaultTheme;
    if (defaultTheme !== undefined) {
      assertCan(actor, 'workspace:brand');
      $set['settings.defaultTheme'] = defaultTheme ? await assertThemeChoice(defaultTheme, actor.workspace) : null;
    }

    const workspace = await WorkspaceModel.findOneAndUpdate(
      { _id: actor.workspace._id, deletedAt: null },
      { $set },
      { returnDocument: 'after', runValidators: true },
    );
    if (!workspace) throw ApiError.notFound('Workspace not found');
    return { workspace, membership: actor.membership };
  }

  /** Makes the workspace the user's default: used without X-Workspace-Id, by MCP tokens and at next sign-in. */
  static async switchDefault(actor: WorkspaceActor): Promise<void> {
    await UserModel.updateOne({ _id: actor.user.id }, { $set: { defaultWorkspaceId: actor.workspace._id } });
  }
}
