/**
 * Read-only report of what the plan limits do to existing data, for the
 * migration rehearsal (docs/planning/06-merge-and-deploy.md, Phase 1). Run it
 * after `bun run migrate` on the rehearsal copy, never against production:
 *
 *   MONGO_URI=… bun scripts/plan-impact.ts
 *
 * It lists the polls that already reach their workspace's audience cap (they
 * stop accepting answers) and the ended sessions whose retention date has passed
 * (the hourly privacy-retention-purge job deletes them). Nothing is written.
 */
import mongoose from 'mongoose';
import { getEntitlements } from '../src/common/plans/entitlements';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';

const LIST = 20;

const main = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db!;
  try {
    const workspaces = await WorkspaceModel.find({}, { name: 1, plan: 1, planOverrides: 1, billing: 1 }).lean();
    const capOf = new Map(workspaces.map((ws) => [String(ws._id), getEntitlements(ws as never).limits.audienceCap]));
    const nameOf = new Map(workspaces.map((ws) => [String(ws._id), `${ws.name} (${ws.plan})`]));

    const byPlan = new Map<string, number>();
    for (const ws of workspaces) byPlan.set(ws.plan, (byPlan.get(ws.plan) ?? 0) + 1);
    console.log(`Workspaces: ${workspaces.length} (${[...byPlan].map(([plan, n]) => `${plan} ${n}`).join(', ') || 'none'})`);

    // ---- Polls at or over their audience cap ----
    const counts = await db
      .collection('responses')
      .aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([{ $group: { _id: '$pollId', n: { $sum: 1 } } }])
      .toArray();
    const polls = await db
      .collection('polls')
      .find({ _id: { $in: counts.map((c) => c._id) } }, { projection: { title: 1, workspaceId: 1 } })
      .toArray();
    const pollById = new Map(polls.map((p) => [String(p._id), p]));
    const capped = counts
      .map((c) => {
        const poll = pollById.get(String(c._id));
        const workspaceId = poll?.workspaceId ? String(poll.workspaceId) : null;
        // Polls without a workspace are uncapped (billing/pollCap.ts).
        const cap = workspaceId ? capOf.get(workspaceId) ?? null : null;
        return { poll, workspaceId, responses: c.n, cap };
      })
      .filter((row) => row.cap != null && row.responses >= row.cap)
      .sort((a, b) => b.responses - a.responses);

    console.log(`\nPolls that stop accepting answers (responses >= audience cap): ${capped.length}`);
    for (const row of capped.slice(0, LIST)) {
      console.log(`  ${row.responses}/${row.cap}  ${row.poll?.title ?? String(row.poll?._id)}  [${nameOf.get(row.workspaceId!) ?? row.workspaceId}]`);
    }
    if (capped.length > LIST) console.log(`  … and ${capped.length - LIST} more`);

    // ---- Ended sessions past their retention date ----
    const now = new Date();
    const expiring = await db
      .collection('presentationsessions')
      .find(
        { isLive: false, retainUntil: { $ne: null, $lte: now } },
        { projection: { presentationId: 1, workspaceId: 1, runNumber: 1, endedAt: 1, participantCount: 1 } },
      )
      .sort({ endedAt: 1 })
      .toArray();
    console.log(`\nEnded sessions past retention (deleted within an hour of boot): ${expiring.length}`);
    for (const s of expiring.slice(0, LIST)) {
      const ended = s.endedAt instanceof Date ? s.endedAt.toISOString().slice(0, 10) : '?';
      console.log(`  ended ${ended}  run #${s.runNumber ?? '?'}  ${s.participantCount ?? 0} participants  deck ${String(s.presentationId)}  [${nameOf.get(String(s.workspaceId)) ?? s.workspaceId}]`);
    }
    if (expiring.length > LIST) console.log(`  … and ${expiring.length - LIST} more`);

    const soon = await db.collection('presentationsessions').countDocuments({
      isLive: false,
      retainUntil: { $gt: now, $lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
    });
    console.log(`Ended sessions whose retention ends in the next 30 days: ${soon}`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('[plan-impact]', error instanceof Error ? error.message : error);
  process.exit(1);
});
