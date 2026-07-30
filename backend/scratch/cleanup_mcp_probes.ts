// Throwaway cleanup for data the MCP probe scripts created. Dry-run by default;
// pass --delete to actually remove. Matches only the probes' own generated titles
// so hand-made polls are never touched. Not part of the app.
import mongoose from 'mongoose';
import { PollModel } from '../src/modules/polls/polls.model';
import { ResponseModel } from '../src/modules/responses/responses.model';
import { AnalyticsModel } from '../src/modules/responses/analytics.model';
import { UserModel } from '../src/modules/auth/auth.model';
import { McpTokenModel } from '../src/modules/mcp/mcp.token.model';
import { redisClient } from '../src/common/config/redis';

const APPLY = process.argv.includes('--delete');
const TEST_USER_EMAIL = 'mcp-trial-test@example.com';

// `<name> <Date.now()>` — exactly what the probes generate, nothing else.
const PROBE_TITLE =
  /^(MCP (Assessment Probe|Plain Probe|Smuggle Probe|Graded Probe|Trial Probe|Assessment NoAnswers|Assessment Empty|Assessment OutOfRange|Assessment MultiSingle|Trial NoAnswers|Trial OutOfRange|Trial MultiSingle) \d{13}|Street Food Assessment \(edited\))$/;

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);
  await redisClient.connect().catch(() => {});

  const candidates = await PollModel.find({
    title: /^(MCP (Assessment|Trial|Plain|Graded|Smuggle)|Street Food Assessment)/,
  }).select(
    '_id title pollType creatorId createdAt',
  );

  const doomed = candidates.filter((poll) => PROBE_TITLE.test(poll.title));
  const skipped = candidates.filter((poll) => !PROBE_TITLE.test(poll.title));

  console.log(`${APPLY ? 'DELETING' : 'DRY RUN'} — ${doomed.length} probe polls matched\n`);
  for (const poll of doomed) {
    console.log(`  ${poll._id}  ${poll.pollType.padEnd(5)}  creator=${poll.creatorId}  ${poll.title}`);
  }
  if (skipped.length) {
    console.log(`\n  NOT touching ${skipped.length} near-miss title(s):`);
    for (const poll of skipped) console.log(`    ${poll._id}  ${poll.title}`);
  }

  const pollIds = doomed.map((poll) => poll._id);
  const responseCount = await ResponseModel.countDocuments({ pollId: { $in: pollIds } });
  const analyticsCount = await AnalyticsModel.countDocuments({ pollId: { $in: pollIds } });

  const testUser = await UserModel.findOne({ email: TEST_USER_EMAIL });
  const testTokenCount = testUser ? await McpTokenModel.countDocuments({ userId: String(testUser._id) }) : 0;

  console.log(`\n  responses: ${responseCount}`);
  console.log(`  analytics docs: ${analyticsCount}`);
  console.log(`  test user ${TEST_USER_EMAIL}: ${testUser ? `found (${testUser._id})` : 'absent'}`);
  console.log(`  test user MCP tokens: ${testTokenCount}`);

  if (!APPLY) {
    console.log('\nRe-run with --delete to apply.');
    await shutdown();
    return;
  }

  await ResponseModel.deleteMany({ pollId: { $in: pollIds } });
  await AnalyticsModel.deleteMany({ pollId: { $in: pollIds } });
  await PollModel.deleteMany({ _id: { $in: pollIds } });

  // Vote-dedupe and analytics-buffer keys the submissions left behind.
  for (const pollId of pollIds) {
    const id = String(pollId);
    const keys = [
      ...(await redisClient.keys(`poll:${id}:voted:*`).catch(() => [])),
      ...(await redisClient.keys(`buffer:poll:${id}*`).catch(() => [])),
    ];
    if (keys.length) await redisClient.del(keys).catch(() => {});
    await redisClient.sRem('buffer:active_polls', id).catch(() => {});
  }

  if (testUser) {
    await McpTokenModel.deleteMany({ userId: String(testUser._id) });
    await UserModel.deleteOne({ _id: testUser._id });
  }

  console.log('\nDeleted.');
  await shutdown();
}

async function shutdown() {
  await mongoose.disconnect();
  await redisClient.quit().catch(() => {});
}

main().catch(async (err) => {
  console.error(err);
  await shutdown().catch(() => {});
  process.exit(1);
});
