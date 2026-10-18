/**
 * Sets a workspace's plan by hand (no billing, enterprise contracts, support).
 *
 *   bun scripts/set-plan.ts <workspace> <plan> [--overrides '<json>' | --clear-overrides]
 *
 * <workspace>  workspace id, workspace slug, or an owner's email (their personal workspace)
 * <plan>       free | pro | team | enterprise
 * --overrides  planOverrides JSON replacing the current ones, e.g.
 *              '{"limits":{"audienceCap":5000},"features":{"white_label":true}}'
 *
 * Marks the plan as manual (planSource=manual) so billing sync leaves it alone,
 * records an audit event and prints the resulting entitlements.
 */
import { env } from '../src/common/config/env';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { connectDB } from '../src/common/config/db';
import { audit } from '../src/common/audit/audit';
import { getEntitlements } from '../src/common/plans/entitlements';
import { PLAN_IDS, isPlanId, planOverridesSchema, type PlanOverrides } from '../src/common/plans/plans';
import { UserModel } from '../src/modules/auth/auth.model';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';
import { ensurePersonalWorkspace } from '../src/modules/workspaces/provisioning';

const usage = `Usage: bun scripts/set-plan.ts <workspace-id|slug|owner-email> <${PLAN_IDS.join('|')}> [--overrides '<json>' | --clear-overrides]`;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    overrides: { type: 'string' },
    'clear-overrides': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

if (values.help || positionals.length !== 2) fail(usage);
const [target, plan] = positionals as [string, string];
if (!isPlanId(plan)) fail(`Unknown plan "${plan}". ${usage}`);
if (values.overrides && values['clear-overrides']) fail('Use either --overrides or --clear-overrides');

let overrides: PlanOverrides | null | undefined;
if (values['clear-overrides']) overrides = null;
if (values.overrides) {
  let json: unknown;
  try {
    json = JSON.parse(values.overrides);
  } catch {
    fail('--overrides is not valid JSON');
  }
  const parsed = planOverridesSchema.safeParse(json);
  if (!parsed.success) fail(`Invalid --overrides: ${parsed.error.message}`);
  overrides = parsed.data;
}

async function findWorkspace(value: string) {
  if (/^[a-f0-9]{24}$/i.test(value)) {
    const byId = await WorkspaceModel.findById(value);
    if (byId) return byId;
  }
  if (value.includes('@')) {
    const owner = await UserModel.findOne({ email: value.toLowerCase() });
    if (!owner) return null;
    return (await ensurePersonalWorkspace(owner)).workspace;
  }
  return WorkspaceModel.findOne({ slug: value.toLowerCase() });
}

console.log(`[SetPlan] ${env.NODE_ENV}`);
await connectDB();
try {
  const workspace = await findWorkspace(target);
  if (!workspace) throw new Error(`No workspace matches "${target}"`);
  if (workspace.deletedAt) throw new Error(`Workspace ${workspace.slug} is deleted`);

  const previous = { plan: workspace.plan, planSource: workspace.planSource, planOverrides: workspace.planOverrides ?? null };
  workspace.plan = plan as typeof workspace.plan;
  workspace.planSource = 'manual';
  if (overrides !== undefined) {
    workspace.planOverrides = overrides;
    workspace.markModified('planOverrides');
  }
  await workspace.save();

  await audit({ actorType: 'system', workspace }, 'workspace.plan.set', { type: 'workspace', id: workspace._id }, {
    previous,
    plan,
    planOverrides: workspace.planOverrides ?? null,
    via: 'scripts/set-plan.ts',
  });

  console.log(`[SetPlan] ${workspace.slug} (${String(workspace._id)}): ${previous.plan} -> ${plan}`);
  console.log(JSON.stringify(getEntitlements(workspace), null, 2));
} catch (error) {
  console.error('[SetPlan] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
