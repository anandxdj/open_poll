import type { Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, openLobby, test, type Host } from "./fixtures";

/**
 * W4-D add-in panes, as pages in the browser (Office, Teams and Zoom cannot
 * run here). The host SDKs (Office.js, the Teams library) are blocked so the
 * run needs no network: each pane must work without its host, just without
 * the host's extras. A screen link is made through the API; the Embed dialog
 * itself is covered by embeds.spec.ts.
 */

const FRONTEND = e2eEnv.frontendUrl;

const SELECT = {
  type: "select_answer",
  question: "Best add-in host?",
  timeLimit: 120,
  options: [
    { text: "PowerPoint", isCorrect: false },
    { text: "Teams", isCorrect: true },
  ],
};

const api = async <T = unknown>(host: Host, method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.accessToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { data: T };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json.data;
};

/** A deck that allows embedding, with a screen link. */
async function deckWithScreenLink(host: Host, title: string) {
  const deck = await host.createDeck(`${title} ${Date.now()}`, [SELECT]);
  await api(host, "PATCH", `/presentations/${deck._id}`, { settings: { embed: { allowed: true } } });
  const { token } = await api<{ token: string }>(host, "POST", "/embeds/screen-tokens", { presentationId: deck._id, label: title });
  return { deck, link: `${FRONTEND}/embed/stage/${deck._id}?token=${token}` };
}

/** Blocks the host SDKs: the panes must not depend on them outside their host. */
async function blockHostSdks(page: Page) {
  await page.route(/appsforoffice\.microsoft\.com|res\.cdn\.office\.net/, (route) => route.abort());
}

async function openPane(browser: import("@playwright/test").Browser, contexts: import("@playwright/test").BrowserContext[], path: string) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await blockHostSdks(page);
  const response = await page.goto(path);
  return { page, response };
}

test("the PowerPoint task pane shows a deck's stage from a pasted screen link and remembers it", async ({ browser, contexts, host }) => {
  const { deck, link } = await deckWithScreenLink(host, "E2E PowerPoint pane");
  const { page, response } = await openPane(browser, contexts, "/addins/powerpoint");
  // Microsoft 365 may frame it; nobody else.
  const csp = response!.headers()["content-security-policy"]!;
  expect(csp).toContain("frame-ancestors 'self' https://*.office.com");
  expect(csp).toContain("https://*.officeapps.live.com");

  await expect(page.getByRole("heading", { name: "Open Poll stage" })).toBeVisible();
  const field = page.getByLabel("Screen link");
  await field.fill("https://evil.example/embed/stage/x?token=y");
  await page.getByRole("button", { name: "Show the stage" }).click();
  await expect(page.getByText(`Paste a screen link from this site: ${FRONTEND}/embed/stage/…`)).toBeVisible();

  await field.fill(link);
  await page.getByRole("button", { name: "Show the stage" }).click();
  await expect(page.getByRole("heading", { name: "Ready to present" })).toBeVisible();
  await expect(page.getByText(deck.title)).toBeVisible();

  // It follows the session live.
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await openLobby(hostPage, deck.joinCode);
  await expect(page.getByText(deck.joinCode, { exact: true })).toBeVisible();

  // Kept for the next time the pane opens (in PowerPoint: in the presentation file).
  await page.reload();
  await expect(page.getByText(deck.joinCode, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Change screen link" }).click();
  await expect(page.getByLabel("Screen link")).toBeVisible();
});

test("the Teams tab: configuration, the side panel where attendees answer, and the meeting stage", async ({ browser, contexts, host }) => {
  const { deck, link } = await deckWithScreenLink(host, "E2E Teams tab");
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await openLobby(hostPage, deck.joinCode);

  // Configuration page: outside Teams it shows the tab it would save.
  const { page: config, response } = await openPane(browser, contexts, "/addins/teams/config");
  expect(response!.headers()["content-security-policy"]).toContain("https://teams.microsoft.com");
  await expect(config.getByRole("heading", { name: "Add Open Poll to Teams" })).toBeVisible();
  await config.getByLabel("Screen link").fill(link);
  await config.getByRole("button", { name: "Use this screen link" }).click();
  await expect(config.getByText("Open this page from Teams to save the tab.")).toBeVisible();
  const tabUrl = await config.getByRole("textbox", { name: "Tab address" }).inputValue();
  expect(tabUrl).toBe(`${FRONTEND}/addins/teams/sidepanel?link=${encodeURIComponent(link)}`);

  // Side panel: the participant view of the deck; sharing to the stage needs a meeting.
  const { page: panel } = await openPane(browser, contexts, tabUrl.replace(FRONTEND, ""));
  await expect(panel.getByRole("button", { name: "Show on meeting stage" })).toBeDisabled();
  await panel.getByPlaceholder("Your nickname").fill("Ada");
  await panel.getByRole("button", { name: "Join Session" }).click();
  await expect(panel.getByRole("heading", { name: "You're in!" })).toBeVisible();
  await expect(hostPage.locator("main").getByText("Ada", { exact: true })).toBeVisible();

  // Meeting stage: the read-only stage of the same deck.
  const { page: stage } = await openPane(browser, contexts, `/addins/teams/stage?link=${encodeURIComponent(link)}`);
  await expect(stage.getByText("Ada", { exact: true })).toBeVisible();
  await expect(stage.getByText("1 JOINED")).toBeVisible();

  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByRole("heading", { name: SELECT.question })).toBeVisible();
  await expect(panel.getByRole("heading", { name: SELECT.question })).toBeVisible();
  await expect(async () => {
    await panel.getByRole("button", { name: /Teams/ }).click();
    await expect(panel.getByRole("button", { name: "Submit Answer" })).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await panel.getByRole("button", { name: "Submit Answer" }).click();
  await expect(stage.locator("main")).toContainText(/1\s*\/\s*1\s*answered/);

  // A broken link is not a stage.
  const { page: broken } = await openPane(browser, contexts, "/addins/teams/sidepanel?link=nope");
  await expect(broken.getByText("This embed isn't available")).toBeVisible();
});

test("the Zoom app page sends Zoom's OWASP headers and shows the stage", async ({ browser, contexts, host }) => {
  const { deck, link } = await deckWithScreenLink(host, "E2E Zoom app");
  const { page, response } = await openPane(browser, contexts, "/addins/zoom");
  const headers = response!.headers();
  expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'self' https://*.zoom.us");

  await page.getByLabel("Screen link").fill(link);
  await page.getByRole("button", { name: "Show the stage" }).click();
  await expect(page.getByRole("heading", { name: "Ready to present" })).toBeVisible();
  await expect(page.getByText(deck.title)).toBeVisible();

  // Embedding turned off: the pane says so instead of showing the stage.
  await api(host, "PATCH", `/presentations/${deck._id}`, { settings: { embed: { allowed: false } } });
  await page.reload();
  await expect(page.getByText("Embedding is turned off")).toBeVisible();
});
