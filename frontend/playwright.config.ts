import { defineConfig, devices } from "@playwright/test";
import { e2eEnv } from "./e2e/env";

/** Backend settings of optional integrations (see backend/.env.example); the e2e backend runs with all of them unset. */
const OPTIONAL_INTEGRATIONS = [
  "ALLOWED_ORIGINS",
  "DOMAIN_CNAME_TARGET",
  "DOMAIN_PROVISIONER",
  "DOMAIN_VERCEL_PROJECT_ID",
  "DOMAIN_VERCEL_TEAM_ID",
  "DOMAIN_VERCEL_TOKEN",
  "ENCRYPTION_KEY",
  "GEMINI_MODEL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_DRIVE_API_KEY",
  "GOOGLE_DRIVE_APP_ID",
  "GOOGLE_DRIVE_IMPORT_ENABLED",
  "GOOGLE_REDIRECT_URI",
  "GOTENBERG_URL",
  "LLM_MODEL",
  "METRICS_TOKEN",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_ISSUER",
  "OIDC_REDIRECT_URI",
  "RESEND_FROM_EMAIL",
  "RESEND_FROM_NAME",
  "S3_ACCESS_KEY_ID",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_PUBLIC_URL",
  "S3_REGION",
  "S3_SECRET_ACCESS_KEY",
  "SOCKET_REDIS_ADAPTER",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_TEAM_MONTHLY",
  "STRIPE_PRICE_TEAM_YEARLY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

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
      // Migrate first, as the container entrypoint does (idempotent).
      command: "bun scripts/migrate.ts && bun src/app.ts",
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
        JWT_ACCESS_SECRET: "e2e-access-secret",
        JWT_REFRESH_SECRET: "e2e-refresh-secret",
        ID_SIGNING_SECRET: "e2e-id-signing-secret",
        JWT_ACCESS_EXPIRES_IN: "2h",
        // Empty AI and mail keys: drafts are mocked and mail is logged.
        LLM_BASE_URL: "",
        LLM_API_KEY: "",
        GEMINI_API_KEY: "",
        RESEND_API_KEY: "",
        // Every optional integration is off: a backend/.env written for local development (S3,
        // Stripe, metrics, ...) must not leak in (Bun loads it, a blank value here wins) because
        // the specs assert the disabled mode of storage, billing and imports.
        ...Object.fromEntries(OPTIONAL_INTEGRATIONS.map((key) => [key, ""])),
        // Single sign-on and SCIM (W3-D) need an encryption key; a fixed one for tests only.
        ENCRYPTION_KEY: "e2e0".repeat(16),
        API_PUBLIC_URL: e2eEnv.apiOrigin,
        // Custom domains (W4-E) through Caddy's on-demand TLS: nothing to call out to.
        DOMAIN_PROVISIONER: "caddy",
        DOMAIN_CNAME_TARGET: "cname.openpoll.test",
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
        // Same for frontend/.env.local: the landing and security headers must see them unset.
        NEXT_PUBLIC_SALES_EMAIL: "",
        NEXT_PUBLIC_STORAGE_PUBLIC_URL: "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
