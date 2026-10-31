import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * Privacy (W4-C) as a person sees it: on a fresh account, download your data,
 * set how long the workspace keeps session results, delete the account (signed
 * out, the old token stops working, the login page says when it goes), then
 * log in again, which keeps the account.
 *
 * A fresh account per run, so the daily export count and the deletion never
 * touch the shared e2e host.
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

interface Account {
  user: { _id: string; email: string; name: string };
  accessToken: string;
}

const apiFetch = (path: string, init: RequestInit & { token?: string } = {}) =>
  fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
  });

/** A page signed in as `account` (the proxy cookie and the persisted auth store, as after a real sign-in). */
async function openAs(browser: Browser, contexts: BrowserContext[], account: Account, path: string): Promise<Page> {
  const context = await browser.newContext({ acceptDownloads: true });
  contexts.push(context);
  await context.addCookies([{ name: "auth_session", value: "1", url: e2eEnv.frontendUrl }]);
  await context.addInitScript(
    ({ user, accessToken }) => {
      window.localStorage.setItem("auth-storage", JSON.stringify({ state: { user, accessToken }, version: 0 }));
    },
    { user: account.user, accessToken: account.accessToken },
  );
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test("download your data, set data retention, delete the account and keep it by logging in again", async ({ browser, contexts }) => {
  const stamp = Date.now();
  const email = `e2e-privacy-${stamp}@openpoll.test`;
  const password = "E2ePrivacy!2345";
  execFileSync("bun", ["scripts/seed-e2e-user.ts", email, password, "Priya Privacy"], {
    cwd: e2eEnv.backendDir,
    env: backendEnv,
    stdio: "pipe",
  });
  const login = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const account = ((await login.json()) as { data: Account }).data;

  // ---- Data retention on the personal workspace ----
  const page = await openAs(browser, contexts, account, "/settings/workspace");
  const retention = page.getByLabel("Keep session results");
  await expect(retention).toBeVisible();
  await retention.selectOption({ label: "90 days" });
  await expect(page.getByText("Data retention saved")).toBeVisible();
  const workspaces = (await (await apiFetch("/workspaces", { token: account.accessToken })).json()) as {
    data: { workspaces: { _id: string; type: string }[] };
  };
  const personal = workspaces.data.workspaces.find((w) => w.type === "personal")!;
  const detail = (await (await apiFetch(`/workspaces/${personal._id}`, { token: account.accessToken })).json()) as {
    data: { workspace: { settings: { retentionDays: number | null } } };
  };
  expect(detail.data.workspace.settings.retentionDays).toBe(90);

  // ---- Download your data ----
  await page.goto("/settings/privacy");
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await expect(page.getByText("3 of 3 downloads left today.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toMatch(/^openpoll-data-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.getByText(/Last downloaded .+ \(\d+ KB\)\. 2 of 3 downloads left today\./)).toBeVisible();

  // ---- Delete the account (the sign-in above is under 5 minutes old: no password needed) ----
  await page.getByRole("button", { name: "Delete account…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("we delete your account and your personal workspace");
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/login\?deleted=/);
  await expect(page.getByText(/Your account will be deleted on .+\. Log in before then to keep it\./)).toBeVisible();
  expect((await apiFetch("/auth/me", { token: account.accessToken })).status).toBe(401);

  // ---- Logging in again keeps the account ----
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Welcome back. Your account will not be deleted.")).toBeVisible();
  await expect(page).toHaveURL(/\/home/);
});
