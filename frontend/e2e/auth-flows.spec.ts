import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * The sign-up funnel and account recovery as a person goes through them:
 * sign up, try to log in before verifying, open the verification link, log in;
 * then forget the password, open the reset link, choose a new one and log in
 * with it. The e2e backend has no mail provider, so a script issues the link's
 * token the way the email would carry it. Also: signed-out visitors on app
 * pages land on the login page.
 */

const backendEnv = {
  ...process.env,
  MONGO_URI: e2eEnv.mongoUri,
  REDIS_URL: e2eEnv.redisUrl,
  FRONTEND_URL: e2eEnv.frontendUrl,
  JWT_ACCESS_SECRET: "e2e-access-secret",
  JWT_REFRESH_SECRET: "e2e-refresh-secret",
  ID_SIGNING_SECRET: "e2e-id-signing-secret",
};

const backend = (script: string, ...args: string[]) =>
  execFileSync("bun", [script, ...args], { cwd: e2eEnv.backendDir, env: backendEnv, stdio: "pipe" }).toString().trim();

/** What the verification or reset email would link to. */
const issueToken = (email: string, kind: "verify" | "reset") => backend("scripts/e2e-issue-token.ts", email, kind);

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.beforeAll(() => {
  // This file logs in several times: start from clean auth rate-limit windows.
  backend("scripts/seed-e2e-user.ts", e2eEnv.hostEmail, e2eEnv.hostPassword, "E2E Host");
});

test("sign up, verify the email, then log in", async ({ browser, contexts }) => {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const email = `e2e-signup-${Date.now()}@openpoll.test`;
  const password = "E2eSignup!2345";

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Sana Signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Check your email").first()).toBeVisible();

  // Not verified yet: the login refuses and says why.
  await logIn(page, email, password);
  await expect(page.getByText("Please verify your email before logging in")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // A wrong link fails clearly.
  await page.goto("/verify-email/not-a-real-token");
  await expect(page.getByText("Verification failed")).toBeVisible();

  await page.goto(`/verify-email/${issueToken(email, "verify")}`);
  await expect(page.getByText("Email verified")).toBeVisible();
  await page.getByRole("link", { name: "Continue to login" }).click();
  // Let the link's own navigation land first: a goto racing it is aborted (NS_BINDING_ABORTED in Firefox).
  await expect(page).toHaveURL(/\/login/);

  await logIn(page, email, password);
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("heading", { name: /Sana/ })).toBeVisible();
});

test("forgot password, reset it from the link, log in with the new one", async ({ browser, contexts }) => {
  const email = `e2e-reset-${Date.now()}@openpoll.test`;
  const oldPassword = "E2eReset!2345";
  const newPassword = "E2eReset!6789";
  backend("scripts/seed-e2e-user.ts", email, oldPassword, "Rae Reset");

  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your inbox").first()).toBeVisible();

  await page.goto(`/reset-password/${issueToken(email, "reset")}`);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill("Something!else1");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Passwords do not match")).toBeVisible();

  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/\/login/);

  await logIn(page, email, oldPassword);
  await expect(page.getByText("Invalid email or password")).toBeVisible();

  await logIn(page, email, newPassword);
  await expect(page).toHaveURL(/\/home/);
});

test("an expired access token refreshes silently; a lost session goes to login; log out ends it", async ({ browser, contexts }) => {
  const email = `e2e-session-${Date.now()}@openpoll.test`;
  const password = "E2eSession!2345";
  backend("scripts/seed-e2e-user.ts", email, password, "Sol Session");

  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await logIn(page, email, password);
  await expect(page).toHaveURL(/\/home/);

  const breakAccessToken = () =>
    page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("auth-storage") ?? "{}");
      stored.state.accessToken = "expired.access.token";
      localStorage.setItem("auth-storage", JSON.stringify(stored));
    });

  // Expired access token, refresh cookie still valid: the page loads as if nothing happened.
  await breakAccessToken();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Sol/ })).toBeVisible();
  await expect(page).toHaveURL(/\/home/);

  // The refresh cookie is gone too (signed out elsewhere, expired): back to the login page.
  await breakAccessToken();
  await context.clearCookies({ name: "refreshToken" });
  await page.reload();
  await expect(page).toHaveURL(/\/login/);

  // Log out from the account menu: the app pages are closed again.
  await logIn(page, email, password);
  await expect(page).toHaveURL(/\/home/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);
});

test("signed-out visitors on app pages go to the login page", async ({ browser, contexts }) => {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  for (const path of ["/home", "/polls", "/settings/profile", "/analytics", "/presentation/create", "/presentation/host/000000000000000000000000"]) {
    await page.goto(path);
    await expect(page, `${path} should send a signed-out visitor to /login`).toHaveURL(/\/login/);
  }
});
