import { execFileSync } from "node:child_process";
import { e2eEnv } from "./env";

/** Seeds the verified host account and resets rate-limit counters. */
export default function globalSetup() {
  execFileSync(
    "bun",
    ["scripts/seed-e2e-user.ts", e2eEnv.hostEmail, e2eEnv.hostPassword, "E2E Host"],
    {
      cwd: e2eEnv.backendDir,
      env: { ...process.env, MONGO_URI: e2eEnv.mongoUri, REDIS_URL: e2eEnv.redisUrl },
      stdio: "inherit",
    }
  );
}
