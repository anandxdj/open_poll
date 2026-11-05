import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, joinAsParticipant, openLobby, test } from "./fixtures";

/**
 * Brand kits (W3-A) as an admin and the room see them: on a Pro workspace,
 * create a kit with its own accent and font (the contrast checks stop an
 * unreadable palette), pick it for a deck in the builder's Theme tab, then
 * open the session and find the kit's colours on the stage and the phone.
 *
 * A fresh account per run on its own Pro workspace, so nothing touches the
 * shared host's free plan.
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

const runBackendScript = (script: string, args: string[]) =>
  execFileSync("bun", [script, ...args], { cwd: e2eEnv.backendDir, env: backendEnv, stdio: "pipe" });

interface Account {
  user: { _id: string; email: string; name: string };
  accessToken: string;
}

const apiJson = async <T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
  });
  expect(res.ok, `${init.method ?? "GET"} ${path} → ${res.status}`).toBe(true);
  return ((await res.json()) as { data: T }).data;
};

async function openAs(browser: Browser, contexts: BrowserContext[], account: Account, path: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  await context.addCookies([{ name: "auth_session", value: "1", url: e2eEnv.frontendUrl }]);
  await context.addInitScript(
    ({ user, accessToken }) => {
      window.localStorage.setItem("auth-storage", JSON.stringify({ state: { user, accessToken }, version: 0 }));
    },
    { user: account.user, accessToken: account.accessToken },
  );
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.documentElement.appendChild(style);
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(path);
  return page;
}

/** A deck theme variable as the page computes it inside the theme scope. */
const deckVar = (page: Page, name: string) =>
  page.evaluate((n) => {
    const scope = document.querySelector("[data-deck-theme]");
    return scope ? getComputedStyle(scope).getPropertyValue(n).trim() : "";
  }, name);

test("create a brand kit, pick it for a deck and see it on the stage and the phone", async ({ browser, contexts }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const email = `e2e-brand-${stamp}@openpoll.test`;
  const password = "E2eBrand!2345";
  runBackendScript("scripts/seed-e2e-user.ts", [email, password, "Bea Brand"]);
  const account = await apiJson<Account>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const { workspaces } = await apiJson<{ workspaces: { slug: string; type: string }[] }>("/workspaces", { token: account.accessToken });
  runBackendScript("scripts/set-plan.ts", [workspaces.find((w) => w.type === "personal")!.slug, "pro"]);

  // ---- Create the kit ----
  const page = await openAs(browser, contexts, account, "/settings/brand");
  await expect(page.getByRole("heading", { name: "Brand kits" })).toBeVisible();
  await page.getByRole("button", { name: "New brand kit" }).click();
  const editor = page.getByRole("form", { name: "New brand kit" });
  await editor.getByLabel("Name").fill("Acme");
  await editor.getByLabel("Accent", { exact: true }).fill("#ffcc00");
  await editor.getByLabel("Text on accent", { exact: true }).fill("#1a1400");
  await editor.getByLabel("Headings").selectOption("Montserrat");

  // An unreadable text colour blocks saving until it is fixed.
  await editor.getByLabel("Text", { exact: true }).fill("#1f1f1d");
  await expect(page.getByText(/too hard to read\. Fix (it|them) to save\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create brand kit" })).toBeDisabled();
  await editor.getByLabel("Text", { exact: true }).fill("#f2f1ec");
  await page.screenshot({ path: "test-results/brand-editor.png", fullPage: true });
  await page.getByRole("button", { name: "Create brand kit" }).click();
  await expect(page.getByText("Brand kit created")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Acme" })).toBeVisible();
  await page.screenshot({ path: "test-results/brand-list.png", fullPage: true });

  // ---- Pick it for a deck in the builder ----
  const deck = await apiJson<{ _id: string; joinCode: string }>("/presentations", {
    method: "POST",
    token: account.accessToken,
    body: JSON.stringify({
      title: `Branded ${stamp}`,
      slides: [{ type: "select_answer", question: "Ready?", options: [{ text: "Yes", isCorrect: true }, { text: "No", isCorrect: false }] }],
    }),
  });
  await page.goto(`/presentation/create?id=${deck._id}`);
  await page.getByRole("tab", { name: "Theme" }).click();
  await page.getByRole("radio", { name: "Acme" }).click();
  await expect(page.getByText("Theme saved")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Acme" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/brand-theme-tab.png", fullPage: true });

  // ---- The session wears it ----
  await page.goto(`/presentation/host/${deck._id}`);
  await openLobby(page, deck.joinCode);
  await expect.poll(() => deckVar(page, "--deck-accent")).toBe("#ffcc00");
  await expect.poll(() => deckVar(page, "--deck-stage-ink")).toBe("#1a1400");
  await expect.poll(() => deckVar(page, "--theme-font-heading")).toContain("Montserrat");
  await page.screenshot({ path: "test-results/brand-stage-lobby.png" });

  const phone = await joinAsParticipant(browser, contexts, deck.joinCode, "Pat");
  await expect.poll(() => deckVar(phone.page, "--deck-primary")).toBe("#ffcc00");
  await phone.page.screenshot({ path: "test-results/brand-phone.png" });
});
