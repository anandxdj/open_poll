import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { e2eEnv } from "./env";
import { expect, test, type Host } from "./fixtures";

/**
 * Session history and reports: a deck is run through the real join and answer
 * routes (the live UI has its own specs), then the creator reads the history
 * and report, exports, shares a public link that opens without an account,
 * and a participant opens their own results. Everything asserted here is what
 * a person sees: text, roles and downloads.
 */

type ApiBody<T> = { success: boolean; message: string; data: T };

const api = async <T = unknown>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => null)) as ApiBody<T> | null;
  if (!res.ok || !body) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  return body.data;
};

const setPlan = (plan: "free" | "pro") =>
  execFileSync("bun", ["scripts/set-plan.ts", e2eEnv.hostEmail, plan], {
    cwd: e2eEnv.backendDir,
    env: { ...process.env, MONGO_URI: e2eEnv.mongoUri, REDIS_URL: e2eEnv.redisUrl },
    stdio: "ignore",
  });

const slides = [
  {
    type: "select_answer",
    question: "Capital of France?",
    timeLimit: 60,
    notes: "SPEAKER-NOTE-never-public",
    options: [
      { text: "Paris", isCorrect: true },
      { text: "Lyon", isCorrect: false },
    ],
  },
  { type: "wordcloud", question: "One word for Mondays", timeLimit: 0, maxEntries: 1 },
];

interface Joined {
  participantId: string;
  token: string;
  name: string;
}

/** Runs a deck: Ada and Linus answer right, Grace wrong, everyone adds a word; then ends it. */
async function runDeck(deckId: string, hostToken: string) {
  const command = (name: string, body?: unknown) =>
    api(`/presentations/${deckId}/host/${name}`, { method: "POST", token: hostToken, body });

  const opened = (await command("open-lobby")) as { session: { sessionId: string } };
  const sessionId = opened.session.sessionId;
  const joined: Joined[] = [];
  for (const name of ["Ada", "Grace", "Linus"]) {
    const who = await api<{ participantId: string; token: string }>(`/presentations/${deckId}/join`, {
      method: "POST",
      body: { name },
    });
    joined.push({ participantId: who.participantId, token: who.token, name });
  }
  await command("start");
  const answer = (who: Joined, slideIndex: number, body: Record<string, unknown>) =>
    api(`/presentations/${deckId}/answer`, {
      method: "POST",
      body: { participantId: who.participantId, participantToken: who.token, slideIndex, ...body },
    });
  await answer(joined[0]!, 0, { optionIndex: 0 });
  await answer(joined[1]!, 0, { optionIndex: 1 });
  await answer(joined[2]!, 0, { optionIndex: 0 });
  await command("goto", { slideIndex: 1 });
  await answer(joined[0]!, 1, { entries: ["pizza"] });
  await answer(joined[1]!, 1, { entries: ["pizza"] });
  await answer(joined[2]!, 1, { entries: ["tacos"] });
  await command("end");
  return { sessionId, joined };
}

/**
 * Opens `path` signed in. The fixture seeds the auth cookie with an init script, which runs after
 * the first response, so a protected route as the first request would bounce to /login: land on a
 * public page first, then navigate.
 */
async function openSignedIn(host: Host, path: string) {
  const page = await host.open("/live");
  await page.goto(path);
  return page;
}

test.describe.configure({ mode: "serial" });

test("history, report, exports, sharing, participant results and deletion", async ({ browser, contexts, host }) => {
  setPlan("free");
  const deck = await host.createDeck(`E2E sessions ${Date.now()}`, slides);
  const { sessionId, joined } = await runDeck(deck._id, host.accessToken);
  const [ada, grace] = joined as [Joined, Joined];

  // --- History: the finished run is listed with its numbers ---
  const page = await openSignedIn(host, `/presentations/${deck._id}/sessions`);
  await expect(page.getByRole("heading", { name: deck.title })).toBeVisible();
  const row = page.getByRole("link", { name: /Session 1/ });
  await expect(row).toContainText("Ended");
  await expect(row).toContainText(/Participants:\s*3/);
  await expect(row).toContainText(/Responses:\s*6/);
  await row.click();

  // --- Report: numbers, each slide's chart, standings, participants ---
  await expect(page).toHaveURL(new RegExp(`/presentations/${deck._id}/sessions/${sessionId}$`));
  await expect(page.getByRole("heading", { name: deck.title })).toBeVisible();
  await expect(page.getByText("Results by slide")).toBeVisible();
  const first = page.getByRole("article", { name: /Slide 1: Capital of France\?/ });
  await expect(first).toContainText("Paris");
  await expect(first).toContainText("Lyon");
  await expect(first).toContainText("3 responses");
  const second = page.getByRole("article", { name: /Slide 2: One word for Mondays/ });
  await expect(second).toContainText("pizza");
  await expect(second).toContainText("tacos");
  const standings = page.getByRole("region", { name: "Leaderboard" });
  await expect(standings).toContainText("Ada");
  await expect(standings).toContainText("Grace");
  const table = page.getByRole("region", { name: /Participants/ });
  await expect(table.getByRole("row")).toHaveCount(4);
  await table.getByPlaceholder("Search by name").fill("gra");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Grace");
  await table.getByPlaceholder("Search by name").fill("");
  // Speaker notes never reach the report page.
  await expect(page.getByText("SPEAKER-NOTE-never-public")).toHaveCount(0);

  // --- Export: CSV downloads; Excel is locked on the free plan with a clear message ---
  await page.getByRole("button", { name: "Export" }).click();
  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /CSV/ }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/-run-1\.csv$/);
  const csvText = (await readFile((await csv.path())!, "utf8")).replace(/^﻿/, "");
  const csvRows = csvText.trim().split("\r\n");
  expect(csvRows[0]).toContain("Participant");
  expect(csvRows).toHaveLength(1 + 3 * 2);
  expect(csvText).toContain("Ada");
  expect(csvText).toContain("Paris");
  expect(csvText).toContain("pizza");

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /Excel/ }).click();
  const locked = page.getByRole("dialog");
  await expect(locked).toContainText("Excel export isn't part of your Free plan");
  await expect(locked.getByRole("link", { name: "See your plan" })).toBeVisible();
  await page.keyboard.press("Escape");

  // --- Share: private by default, link opens without an account, names are opt-in ---
  await page.getByRole("button", { name: "Share results" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create a public link" }).click();
  const linkBox = dialog.getByLabel("Public link");
  await expect(linkBox).toHaveValue(/\/r\/[A-Za-z0-9_-]{32}$/);
  const publicUrl = await linkBox.inputValue();

  const visitor = await browser.newContext();
  contexts.push(visitor);
  const shared = await visitor.newPage();
  await shared.goto(publicUrl);
  await expect(shared.getByRole("heading", { name: deck.title })).toBeVisible();
  await expect(shared.getByText("Shared results")).toBeVisible();
  const sharedFirst = shared.getByRole("article", { name: /Slide 1: Capital of France\?/ });
  await expect(sharedFirst).toContainText("Paris");
  await expect(sharedFirst).toContainText("3 responses");
  await expect(shared.getByText("pizza")).toBeVisible();
  // No names, no notes; search engines are told to stay away.
  await expect(shared.getByText("Ada")).toHaveCount(0);
  await expect(shared.getByText("Grace")).toHaveCount(0);
  await expect(shared.getByText("SPEAKER-NOTE-never-public")).toHaveCount(0);
  await expect(shared.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await dialog.getByLabel("Show participant names").click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Sharing settings saved.").first()).toBeVisible();
  await shared.reload();
  await expect(shared.getByRole("region", { name: "Leaderboard" })).toContainText("Ada");

  await dialog.getByRole("button", { name: "Turn off link" }).click();
  await expect(dialog.getByText(/This link is switched off/)).toBeVisible();
  await shared.reload();
  await expect(shared.getByRole("heading", { name: "These results aren't available" })).toBeVisible();
  await expect(shared.getByText("Capital of France?")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // --- Participant results: only with their own stored identity ---
  const phone = await browser.newContext();
  contexts.push(phone);
  await phone.addInitScript(
    ({ code, sid, who }) => {
      window.localStorage.setItem(`openpoll_participant_${code}_${sid}`, JSON.stringify(who));
    },
    { code: deck.joinCode, sid: sessionId, who: { participantId: ada.participantId, token: ada.token, name: "Ada" } }
  );
  const mine = await phone.newPage();
  await mine.goto(`/live/${deck.joinCode}/summary?sid=${sessionId}`);
  await expect(mine.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(mine.getByText(/#\d of 3/)).toBeVisible();
  const mineFirst = mine.getByRole("article").filter({ hasText: "Capital of France?" });
  await expect(mineFirst).toContainText("Paris");
  await expect(mineFirst).toContainText("Correct");
  await expect(mine.getByRole("article").filter({ hasText: "One word for Mondays" })).toContainText("pizza");
  // The newest stored session is used when the link carries none.
  await mine.goto(`/live/${deck.joinCode}/summary`);
  await expect(mine.getByRole("heading", { name: "Ada" })).toBeVisible();

  // A browser that never joined sees nothing of anyone's results.
  const stranger = await browser.newContext();
  contexts.push(stranger);
  const nobody = await stranger.newPage();
  await nobody.goto(`/live/${deck.joinCode}/summary?sid=${sessionId}`);
  await expect(nobody.getByText("We can't find your answers on this device")).toBeVisible();
  await expect(nobody.getByText("Paris")).toHaveCount(0);

  // Grace's token does not open Ada's results (stolen participant id, wrong secret).
  const thief = await browser.newContext();
  contexts.push(thief);
  await thief.addInitScript(
    ({ code, sid, who }) => window.localStorage.setItem(`openpoll_participant_${code}_${sid}`, JSON.stringify(who)),
    { code: deck.joinCode, sid: sessionId, who: { participantId: ada.participantId, token: grace.token, name: "Grace" } }
  );
  const wrong = await thief.newPage();
  await wrong.goto(`/live/${deck.joinCode}/summary?sid=${sessionId}`);
  await expect(wrong.getByText("This session isn't available anymore")).toBeVisible();
  await expect(wrong.getByText("Paris")).toHaveCount(0);

  // --- Delete: confirm, back to an empty history ---
  await page.getByRole("button", { name: "Delete session" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete session 1?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete session" }).click();
  await expect(page).toHaveURL(new RegExp(`/presentations/${deck._id}/sessions$`));
  await expect(page.getByText("No sessions yet").first()).toBeVisible();
  await visitor.pages()[0]!.reload();
  await expect(visitor.pages()[0]!.getByRole("heading", { name: "These results aren't available" })).toBeVisible();
});

test("Excel and PDF download on a plan that includes them", async ({ host }) => {
  setPlan("pro");
  try {
    const deck = await host.createDeck(`E2E sessions export ${Date.now()}`, slides);
    const { sessionId } = await runDeck(deck._id, host.accessToken);
    const page = await openSignedIn(host, `/presentations/${deck._id}/sessions/${sessionId}`);
    await expect(page.getByText("Results by slide")).toBeVisible();

    for (const [label, extension] of [
      ["Excel", "xlsx"],
      ["PDF", "pdf"],
    ] as const) {
      await page.getByRole("button", { name: "Export" }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: new RegExp(label) }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(new RegExp(`-run-1\\.${extension}$`));
      const bytes = await readFile((await download.path())!);
      expect(bytes.length).toBeGreaterThan(500);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe(extension === "pdf" ? "%PDF" : "PK\u0003\u0004");
    }
  } finally {
    setPlan("free");
  }
});

test("the library menu leads to a deck's sessions, and a running session shows as live", async ({ host }) => {
  const deck = await host.createDeck(`E2E sessions live ${Date.now()}`, slides);
  await api(`/presentations/${deck._id}/host/open-lobby`, { method: "POST", token: host.accessToken });

  const page = await openSignedIn(host, `/polls?type=presentation&q=${encodeURIComponent(deck.title)}`);
  await page.getByRole("button", { name: `More actions for ${deck.title}` }).click();
  await page.getByRole("menuitem", { name: "Session history" }).click();
  await expect(page).toHaveURL(new RegExp(`/presentations/${deck._id}/sessions$`));
  const row = page.getByRole("link", { name: /Session 1/ });
  await expect(row).toContainText("Lobby open");

  // A session that has not ended cannot be shared or deleted.
  await row.click();
  await expect(page.getByText("This session is still running")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete session" })).toHaveCount(0);
  await page.getByRole("button", { name: "Share results" }).click();
  await expect(page.getByRole("dialog")).toContainText("End the session to share its results.");
  await page.keyboard.press("Escape");

  await api(`/presentations/${deck._id}/host/end`, { method: "POST", token: host.accessToken });
});
