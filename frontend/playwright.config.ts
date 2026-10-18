import { defineConfig, devices } from "@playwright/test";
import { e2eEnv } from "./e2e/env";

// The backend and the Next dev server boot on dedicated ports against the test
// containers. Locally an already-running server on those ports is reused.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: e2eEnv.frontendUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: e2eEnv.chromiumPath ? { executablePath: e2eEnv.chromiumPath } : {},
      },
    },
  ],
  webServer: [
    {
      name: "backend",
      command: "bun src/app.ts",
      cwd: e2eEnv.backendDir,
      url: `${e2eEnv.apiOrigin}/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NODE_ENV: "development",
        PORT: String(e2eEnv.backendPort),
        MONGO_URI: e2eEnv.mongoUri,
        REDIS_URL: e2eEnv.redisUrl,
        FRONTEND_URL: e2eEnv.frontendUrl,
        JWT_SECRET: "e2e-access-secret",
        JWT_REFRESH_SECRET: "e2e-refresh-secret",
        JWT_ACCESS_EXPIRES_IN: "2h",
        // Empty AI and mail keys: drafts are mocked and mail is logged.
        LLM_BASE_URL: "",
        LLM_API_KEY: "",
        GEMINI_API_KEY: "",
        RESEND_API_KEY: "",
      },
    },
    {
      name: "frontend",
      command: `bun x next dev --port ${e2eEnv.frontendPort}`,
      url: e2eEnv.frontendUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NEXT_PUBLIC_API_URL: e2eEnv.apiOrigin,
        NEXT_PUBLIC_SOCKET_URL: e2eEnv.apiOrigin,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
