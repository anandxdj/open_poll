import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * Custom domains (W4-E) as an admin sees them on an Enterprise workspace: add
 * a hostname, get the CNAME and TXT records to publish, check DNS (nothing is
 * published in tests, so it keeps waiting), remove it.
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

async function openAs(browser: Browser, contexts: BrowserContext[], account: Account, p: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  await context.addCookies([{ name: "auth_session", value: "1", url: e2eEnv.frontendUrl }]);
  await context.addInitScript(
    ({ user, accessToken }) => window.localStorage.setItem("auth-storage", JSON.stringify({ state: { user, accessToken }, version: 0 })),
    { user: account.user, accessToken: account.accessToken },
  );
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(p);
  return page;
}

test("an admin adds a custom domain, sees the DNS records to publish and removes it", async ({ browser, contexts }) => {
  const stamp = Date.now();
  const email = `e2e-domains-${stamp}@openpoll.test`;
  const password = "E2eDomains!2345";
  const run = (args: string[]) => execFileSync("bun", args, { cwd: e2eEnv.backendDir, env: backendEnv, stdio: "pipe" });
  run(["scripts/seed-e2e-user.ts", email, password, "Dom Admin"]);
  const login = await fetch(`${e2eEnv.apiOrigin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const account = ((await login.json()) as { data: Account }).data;
  const list = await fetch(`${e2eEnv.apiOrigin}/api/workspaces`, { headers: { Authorization: `Bearer ${account.accessToken}` } });
  const { workspaces } = ((await list.json()) as { data: { workspaces: { slug: string; type: string }[] } }).data;
  run(["scripts/set-plan.ts", workspaces.find((w) => w.type === "personal")!.slug, "enterprise"]);

  const hostname = `polls-${stamp}.acme.test`;
  const page = await openAs(browser, contexts, account, "/settings/domains");
  await expect(page.getByRole("heading", { name: "Custom domains" })).toBeVisible();
  await page.getByLabel("Add a domain").fill(hostname);
  await page.getByRole("button", { name: "Add domain" }).click();
  const row = page.getByRole("listitem").filter({ hasText: hostname });
  await expect(row.getByText("Waiting for DNS")).toBeVisible();
  await expect(row.getByText("cname.openpoll.test")).toBeVisible();
  await expect(row.getByText(`_openpoll.${hostname}`)).toBeVisible();

  await row.getByRole("button", { name: "Check DNS" }).click();
  await expect(row.getByText(`No TXT record at _openpoll.${hostname} yet.`)).toBeVisible();
  await expect(row.getByText("Waiting for DNS")).toBeVisible();
  await page.screenshot({ path: "test-results/domains-settings.png", fullPage: true });

  await row.getByRole("button", { name: `Remove ${hostname}` }).click();
  await expect(page.getByText(`${hostname} removed`)).toBeVisible();
  await expect(row).toHaveCount(0);
});
