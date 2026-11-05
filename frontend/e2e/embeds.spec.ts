import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { endSession, expect, joinAsParticipant, openLobby, test, type Host } from "./fixtures";

/**
 * W4-D embeds, from the outside: a page on another site iframes our embed
 * pages. The host site is a tiny HTTP server on 127.0.0.1 (another origin than
 * the app's localhost): a page answered by `page.route` counts as a public
 * page to Chromium, whose local-network protection then refuses to frame the
 * local app at all, which is not what a real site sees.
 *
 * - The participant view inside the iframe joins and answers, the host sees
 *   the answer, and the iframe follows the height the page reports.
 * - The builder's Embed dialog turns embedding on and creates a screen link;
 *   the stage embed follows the session live, shows revealed results and goes
 *   blank when the link is turned off; the results embed shows the run.
 * - A page that is not an embed, and an embed of a deck that does not allow
 *   embedding, refuse to be framed.
 */

const FRONTEND = e2eEnv.frontendUrl;

const SELECT = {
  type: "select_answer",
  question: "Capital of France?",
  timeLimit: 120,
  notes: "Speaker notes stay home",
  options: [
    { text: "Paris", isCorrect: true },
    { text: "Lyon", isCorrect: false },
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

const allowEmbedding = (host: Host, deckId: string) => api(host, "PATCH", `/presentations/${deckId}`, { settings: { embed: { allowed: true } } });

/** Pages of the host site, by path; the server is started once for the file. */
const hostPages = new Map<string, string>();
let hostServer: Server;
let HOST_SITE = "";

test.beforeAll(async () => {
  hostServer = createServer((req, res) => {
    const body = hostPages.get((req.url ?? "/").split("?")[0]!);
    res.writeHead(body ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body ?? "not found");
  });
  await new Promise<void>((resolve) => hostServer.listen(0, "127.0.0.1", resolve));
  HOST_SITE = `http://127.0.0.1:${(hostServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => hostServer.close(() => resolve()));
});

/** A page on another site whose body is `html`; it records the heights embeds report and applies them. */
async function openHostSite(contexts: BrowserContext[], browser: Browser, html: string, path = "/") {
  hostPages.set(
    path,
    `<!doctype html><html><head><title>Host site</title></head><body style="margin:0">
${html}
<script>
  window.__heights = [];
  window.addEventListener("message", function (e) {
    if (e.origin !== ${JSON.stringify(FRONTEND)} || !e.data || e.data.type !== "openpoll:embed:resize") return;
    window.__heights.push(e.data.height);
    document.querySelectorAll("iframe").forEach(function (f) {
      if (f.contentWindow === e.source) f.style.height = Math.ceil(e.data.height) + "px";
    });
  });
</script></body></html>`
  );
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));
  await page.goto(`${HOST_SITE}${path}`);
  return { page, consoleLines };
}

/** Chromium blocked the frame for its frame-ancestors: an error page in its place and a console report. */
const framingRefused = (page: Page, consoleLines: string[]) =>
  page.frames().some((frame) => frame.url().startsWith("chrome-error://")) &&
  consoleLines.some((line) => /frame-ancestors/.test(line) && /(Refused to frame|violates)/i.test(line));

const iframeHeight = (page: Page) => page.evaluate(() => document.querySelector("iframe")!.getBoundingClientRect().height);

test("a participant answers inside an iframe on another site; the host sees it; the frame fits its content", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E embed live ${Date.now()}`, [SELECT]);
  await allowEmbedding(host, deck._id);

  // What a CMS gets from oEmbed for the participant link is what the host site pastes.
  const oembed = (await (
    await fetch(`${e2eEnv.apiOrigin}/api/oembed?url=${encodeURIComponent(`${FRONTEND}/live/${deck.joinCode}`)}&format=json`)
  ).json()) as { type: string; html: string; height: number };
  expect(oembed.type).toBe("rich");
  expect(oembed.html).toContain(`src="${FRONTEND}/embed/live/${deck.joinCode}"`);

  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await openLobby(hostPage, deck.joinCode);

  const { page } = await openHostSite(contexts, browser, `<h1>Our town hall</h1>${oembed.html.replace(/height="\d+"/, 'height="300"')}`);
  const frame = page.frameLocator("iframe");
  await expect(page.getByRole("heading", { name: "Our town hall" })).toBeVisible();

  // The join form renders inside the frame, which then reports its height.
  await frame.getByPlaceholder("Your nickname").fill("Ada");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __heights: number[] }).__heights.length)).toBeGreaterThan(0);
  await expect.poll(() => iframeHeight(page)).not.toBe(300);
  const joinHeight = await iframeHeight(page);

  await frame.getByRole("button", { name: "Join Session" }).click();
  await expect(frame.getByRole("heading", { name: "You're in!" })).toBeVisible();
  const stage = hostPage.locator("main");
  await expect(stage.getByText("Ada", { exact: true })).toBeVisible();

  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(frame.getByRole("heading", { name: SELECT.question })).toBeVisible();
  // The frame followed the question's height (taller than the join form).
  await expect.poll(() => iframeHeight(page)).not.toBe(joinHeight);
  // Once settled, the frame is exactly as tall as the page last said.
  await expect
    .poll(async () => {
      const last = await page.evaluate(() => (window as unknown as { __heights: number[] }).__heights.at(-1)!);
      return Math.abs((await iframeHeight(page)) - last) <= 1;
    })
    .toBe(true);

  // The frame grows with the question while it slides in; pick once the option holds still.
  const submit = frame.getByRole("button", { name: "Submit Answer" });
  await expect(async () => {
    await frame.getByRole("button", { name: /Paris/ }).click();
    await expect(submit).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await submit.click();
  await expect(frame.getByText("Answer locked in!")).toBeVisible();
  await expect(stage).toContainText(/1\s*\/\s*1\s*answered/);
  await expect(stage.getByText("100%")).toBeVisible();
});

test("mid-session: embedding turned on from the Embed dialog, and a new screen shows the approved Q&A at once", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await api<{ _id: string; joinCode: string; title: string }>(host, "POST", "/presentations", {
    title: `E2E embed mid-session ${Date.now()}`,
    slides: [SELECT],
    settings: { qna: { enabled: true, moderation: true } },
  });
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await openLobby(hostPage, deck.joinCode);

  // A question asked and approved, then put on screen, before any screen exists.
  const ada = await api<{ participantId: string; token: string }>(host, "POST", `/presentations/${deck._id}/join`, { name: "Ada" });
  const askRes = await fetch(`${e2eEnv.apiOrigin}/api/presentations/${deck._id}/qna`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Participant-Id": ada.participantId, "X-Participant-Token": ada.token },
    body: JSON.stringify({ text: "Will the slides be shared?" }),
  });
  const asked = ((await askRes.json()) as { data: { id: string } }).data;
  await api(host, "PATCH", `/presentations/${deck._id}/host/qna/${asked.id}`, { status: "visible" });
  await api(host, "POST", `/presentations/${deck._id}/host/qna/${asked.id}/highlight`, { highlighted: true });

  // The session is live: the switch still works (only this setting may change mid-session).
  const builder = await host.open(`/presentation/create?id=${deck._id}`);
  await builder.getByRole("button", { name: "Embed", exact: true }).click();
  const dialog = builder.getByRole("dialog");
  const embedSwitch = dialog.getByRole("switch", { name: "Allow embedding" });
  await expect(embedSwitch).not.toBeChecked();
  await embedSwitch.click();
  await expect(embedSwitch).toBeChecked();
  await expect(builder.getByText("Embedding turned on")).toBeVisible();
  await dialog.getByLabel("Screen name").fill("Second screen");
  await dialog.getByRole("button", { name: "Create screen link" }).click();
  const screenUrl = await dialog.getByRole("textbox", { name: "Screen link", exact: true }).inputValue();

  const { page: site } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${screenUrl}" width="960" height="540" style="border:0"></iframe>`,
    "/mid-session"
  );
  const screen = site.frameLocator("iframe");
  await expect(screen.getByText(deck.joinCode, { exact: true })).toBeVisible();
  // Loaded with the stage, not waiting for the next Q&A event.
  await expect(screen.getByText("Will the slides be shared?")).toBeVisible();
  // The host console is undisturbed: still the lobby, with its participant.
  await expect(hostPage.locator("main").getByText("1 JOINED")).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});

test("the stage embed follows the session live, from a screen link made in the Embed dialog", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E embed stage ${Date.now()}`, [SELECT]);

  // --- Builder: Embed dialog, real clicks ---
  const builder = await host.open(`/presentation/create?id=${deck._id}`);
  await builder.getByRole("button", { name: "Embed", exact: true }).click();
  const dialog = builder.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Embed “${deck.title}”` })).toBeVisible();
  const embedSwitch = dialog.getByRole("switch", { name: "Allow embedding" });
  await expect(embedSwitch).not.toBeChecked();
  await expect(dialog.getByText("Screen links work once embedding is on.")).toBeVisible();
  await embedSwitch.click();
  await expect(embedSwitch).toBeChecked();
  await expect(dialog.getByText("Screen links work once embedding is on.")).toBeHidden();
  // The participant view's code, with the deck's join code.
  await expect(dialog.getByRole("textbox", { name: "Embed code" })).toHaveValue(new RegExp(`/embed/live/${deck.joinCode}"`));

  await dialog.getByLabel("Screen name").fill("Main hall");
  await dialog.getByRole("button", { name: "Create screen link" }).click();
  await expect(dialog.getByText("“Main hall” is ready.")).toBeVisible();
  const screenUrl = await dialog.getByRole("textbox", { name: "Screen link", exact: true }).inputValue();
  expect(screenUrl).toMatch(new RegExp(`^${FRONTEND}/embed/stage/${deck._id}\\?token=scr_[A-Za-z0-9_-]{43}$`));
  await expect(dialog.getByRole("textbox", { name: "Stage embed code" })).toHaveValue(new RegExp('width="960" height="540"'));
  await expect(dialog.getByRole("list", { name: "Screen links" }).getByText("Main hall")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await builder.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // --- A web page on another site shows the stage ---
  const { page: site } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${screenUrl}" width="960" height="540" style="border:0"></iframe>`,
    "/stage"
  );
  const screen = site.frameLocator("iframe");
  await expect(screen.getByRole("heading", { name: "Ready to present" })).toBeVisible();
  // Read-only: none of the host's controls.
  await expect(screen.getByRole("button", { name: "Start presenting" })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: "Open lobby" })).toHaveCount(0);

  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await openLobby(hostPage, deck.joinCode);
  await expect(screen.getByText(deck.joinCode, { exact: true })).toBeVisible();

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  await expect(screen.getByText("Ada", { exact: true })).toBeVisible();
  await expect(screen.getByText("2 JOINED")).toBeVisible();

  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(screen.getByRole("heading", { name: SELECT.question })).toBeVisible();
  await expect(screen.getByText("SLIDE 1 OF 1")).toBeVisible();

  await ada.page.getByRole("button", { name: /Paris/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await grace.page.getByRole("button", { name: /Lyon/ }).click();
  await grace.page.getByRole("button", { name: "Submit Answer" }).click();
  // Live counts reach the screen before the reveal.
  await expect(screen.locator("main")).toContainText(/2\s*\/\s*2\s*answered/);
  await expect(screen.getByText("50%")).toHaveCount(2);

  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await expect(screen.getByText("Results revealed")).toBeVisible();

  // --- The results of the run, embedded ---
  await endSession(hostPage);
  await expect(screen.getByRole("heading", { name: "Session ended" })).toBeVisible();
  // A read-only screen does not link to the signed-in report.
  await expect(screen.getByRole("link", { name: /Session report/ })).toHaveCount(0);
  const [session] = await host.getSessions(deck._id);
  const share = await api<{ token: string }>(host, "POST", `/sessions/${session!.sessionId}/share`, {});
  const { page: resultsSite } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${FRONTEND}/embed/results/${share.token}" width="800" height="400" style="border:0"></iframe>`,
    "/results"
  );
  const results = resultsSite.frameLocator("iframe");
  await expect(results.getByRole("heading", { name: deck.title })).toBeVisible();
  await expect(results.getByText("Session 1")).toBeVisible();
  await expect.poll(() => iframeHeight(resultsSite)).toBeGreaterThan(400);

  // --- Turning the screen link off blanks the stage at once ---
  await builder.getByRole("button", { name: "Embed", exact: true }).click();
  const again = builder.getByRole("dialog");
  const links = again.getByRole("list", { name: "Screen links" });
  await links.getByRole("button", { name: "Turn off Main hall" }).click();
  await links.getByRole("group", { name: "Turn off Main hall?" }).getByRole("button", { name: "Turn off" }).click();
  await expect(again.getByText("No screen links yet.")).toBeVisible();
  await expect(screen.getByText("This screen link was turned off")).toBeVisible();
});

test("pages that are not embeds, and decks that do not allow embedding, refuse to be framed", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E embed refused ${Date.now()}`, [SELECT]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await openLobby(hostPage, deck.joinCode);

  // The normal participant page keeps frame-ancestors 'self'.
  const { page: plain, consoleLines: plainConsole } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${FRONTEND}/live/${deck.joinCode}" width="420" height="640"></iframe>`,
    "/plain"
  );
  await expect.poll(() => framingRefused(plain, plainConsole)).toBe(true);
  await expect(plain.frameLocator("iframe").getByPlaceholder("Your nickname")).toHaveCount(0);

  // The embed page of a deck that does not allow embedding is refused the same way.
  const { page: off, consoleLines: offConsole } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${FRONTEND}/embed/live/${deck.joinCode}" width="420" height="640"></iframe>`,
    "/off"
  );
  await expect.poll(() => framingRefused(off, offConsole)).toBe(true);
  await expect(off.frameLocator("iframe").getByPlaceholder("Your nickname")).toHaveCount(0);

  // Opened directly, it says why instead of loading the session.
  const direct = await browser.newContext();
  contexts.push(direct);
  const directPage = await direct.newPage();
  await directPage.goto(`/embed/live/${deck.joinCode}`);
  await expect(directPage.getByText("Embedding is turned off")).toBeVisible();
  await expect(directPage.getByPlaceholder("Your nickname")).toHaveCount(0);

  // An app page refuses too (and an unknown embed is not found).
  const { page: app, consoleLines: appConsole } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${FRONTEND}/login" width="420" height="640"></iframe>`,
    "/app"
  );
  await expect.poll(() => framingRefused(app, appConsole)).toBe(true);
  await directPage.goto("/embed/live/999999");
  await expect(directPage.getByText("This embed isn't available")).toBeVisible();
});

test("Settings → Workspace → Embedding limits which sites may frame the workspace's embeds", async ({ browser, contexts, host }) => {
  const deck = await host.createDeck(`E2E embed sites ${Date.now()}`, [SELECT]);
  await allowEmbedding(host, deck._id);
  const policy = async () =>
    (
      (await (await fetch(`${e2eEnv.apiOrigin}/api/embeds/policy?kind=live&id=${deck.joinCode}`)).json()) as {
        data: { frameAncestors: string[] };
      }
    ).data.frameAncestors;

  const settings = await host.open("/settings/workspace");
  const section = settings.locator("#embedding");
  await expect(section.getByRole("heading", { name: "Embedding" })).toBeVisible();
  await expect(section.getByText("Any site may embed.", { exact: false })).toBeVisible();

  const field = section.getByLabel("Add a site");
  await field.fill("example.com/page");
  await section.getByRole("button", { name: "Add" }).click();
  await expect(section.getByText("Enter a site address like https://example.com", { exact: false })).toBeVisible();

  // Another site listed: ours may no longer frame the workspace's embeds (a second deck, new to the proxy's cache).
  await field.fill("intranet.example.com");
  await section.getByRole("button", { name: "Add" }).click();
  await expect(section.getByRole("list", { name: "Sites allowed to embed" }).getByText("https://intranet.example.com")).toBeVisible();
  const other = await host.createDeck(`E2E embed sites other ${Date.now()}`, [SELECT]);
  await allowEmbedding(host, other._id);
  const { page: unlisted, consoleLines: unlistedConsole } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${FRONTEND}/embed/live/${other.joinCode}" width="420" height="640"></iframe>`,
    "/unlisted"
  );
  await expect.poll(() => framingRefused(unlisted, unlistedConsole)).toBe(true);
  await section.getByRole("button", { name: "Remove https://intranet.example.com" }).click();
  await expect(section.getByText("Any site may embed.", { exact: false })).toBeVisible();

  await field.fill(HOST_SITE);
  await section.getByRole("button", { name: "Add" }).click();
  await expect(section.getByRole("list", { name: "Sites allowed to embed" }).getByText(HOST_SITE)).toBeVisible();
  expect(await policy()).toEqual([HOST_SITE]);

  // The listed site frames the embed (this target is new to the proxy's 10 s cache).
  const { page, consoleLines } = await openHostSite(
    contexts,
    browser,
    `<iframe src="${FRONTEND}/embed/live/${deck.joinCode}" width="420" height="640"></iframe>`,
    "/listed"
  );
  // A deck never presented: the participant view says so, inside the frame.
  await expect(page.frameLocator("iframe").getByText("Presentation Deck Not Found")).toBeVisible();
  expect(framingRefused(page, consoleLines)).toBe(false);

  await section.getByRole("button", { name: `Remove ${HOST_SITE}` }).click();
  await expect(section.getByText("Any site may embed.", { exact: false })).toBeVisible();
  expect(await policy()).toEqual(["*"]);
});
