// Throwaway helper: mint an MCP token for a local test user so scratch/test_mcp_trial.ts
// can exercise the real /mcp endpoint. Not part of the app.
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { UserModel } from '../src/modules/auth/auth.model';
import { McpTokenModel } from '../src/modules/mcp/mcp.token.model';
import { McpTokenService } from '../src/modules/mcp/mcp.token.service';

const EMAIL = 'mcp-trial-test@example.com';

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);

  let user = await UserModel.findOne({ email: EMAIL });
  if (!user) {
    // The probes authenticate with the minted MCP token, not this password, so it
    // is generated rather than hardcoded. Set MCP_TEST_PASSWORD if you need to log
    // in as this user (e.g. to hit /api/mcp/tokens) — it is printed below either way.
    const password = process.env.MCP_TEST_PASSWORD || `probe-${randomBytes(12).toString('base64url')}`;
    user = await UserModel.create({
      email: EMAIL,
      name: 'MCP Trial Tester',
      password,
      isVerified: true,
    });
    console.log(JSON.stringify({ createdUser: EMAIL, password }));
  }

  const userId = String(user._id);
  await McpTokenModel.deleteMany({ userId });

  const issued = await McpTokenService.issueToken(userId, 'trial-e2e');
  console.log(JSON.stringify({ userId, token: issued.token }));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
