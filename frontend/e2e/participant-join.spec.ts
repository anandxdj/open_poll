import type { BrowserContext, Browser, Page } from "@playwright/test";
import { endSession, expect, joinMidSession, openLobby, test } from "./fixtures";

/**
 * How a participant gets in, and stays in: typing the code on /live (PART-01),
 * a code that is not live or a session that is over (PART-05, PART-06), joining
 * late on a content, closed or leaderboard slide (PART-09), and the same device
 * coming back in a new tab or after losing its session credentials (PART-30).
 * Timers are long and driven by hand, so nothing races the auto-reveal.
 */

const planets = {
  type: "select_answer",
  question: "Which planet is known as the Red Planet?",
  timeLimit: 120,
  options: [
    { text: "Mars", isCorrect: true },
    { text: "Venus", isCorrect: false },
  ],
};

/** A fresh device (browser context) on the join page. */
async function phoneOnJoinPage(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/live");
  await expect(page.getByRole("heading", { name: "Join a live deck" })).toBeVisible();
  return page;
}

test("PART-01: a code shorter than 6 digits gets the format message", async ({ browser, contexts }) => {
  const page = await phoneOnJoinPage(browser, contexts);
  const code = page.getByPlaceholder("000000");

  // Only digits are taken.
  await code.fill("12ab45");
  await expect(code).toHaveValue("1245");
  await code.press("Enter");
  await expect(page.getByText("Enter the 6-digit code from your host.")).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/live$/);
});

test("PART-01, PART-05: a code that is not live is refused; once live it reaches the nickname step", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E join by code ${Date.now()}`, [planets]);
  expect(await host.lookupCodeStatus(deck.joinCode)).toBe(404);

  // Typed on /live: the page says there is no live deck and stays put.
  const page = await phoneOnJoinPage(browser, contexts);
  const code = page.getByPlaceholder("000000");
  const join = page.getByRole("button", { name: "Join", exact: true });
  await code.fill(deck.joinCode);
  await join.click();
  await expect(page.getByText("No live deck with that code.")).toBeVisible();
  await expect(page).toHaveURL(/\/live$/);

  // Opened by link: not found.
  await page.goto(`/live/${deck.joinCode}`);
  await expect(page.getByRole("heading", { name: "Presentation Deck Not Found" })).toBeVisible();
  await expect(page.getByText("Check your code and try again.")).toBeVisible();
  await expect(page.getByPlaceholder("Your nickname")).toHaveCount(0);

  // The host opens the lobby: the same code now leads to the nickname step.
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await openLobby(hostPage, deck.joinCode);
  await page.goto("/live");
  await code.fill(deck.joinCode);
  await join.click();
  await expect(page).toHaveURL(new RegExp(`/live/${deck.joinCode}$`));
  await expect(page.getByRole("heading", { name: deck.title })).toBeVisible();
  await expect(page.getByText("Choose a nickname to join the deck.")).toBeVisible();
  await expect(page.getByPlaceholder("Your nickname")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join Session" })).toBeDisabled();
});

test("PART-06: a code whose session is over shows the ended screen to a newcomer", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E ended code ${Date.now()}`, [planets]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(hostPage.locator("main").getByText("SLIDE 1 OF 1")).toBeVisible();
  await endSession(hostPage);
  await expect(hostPage.locator("main").getByRole("heading", { name: "Session ended" })).toBeVisible();

  const page = await phoneOnJoinPage(browser, contexts);
  await page.getByPlaceholder("000000").fill(deck.joinCode);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/live/${deck.joinCode}$`));
  await expect(page.getByRole("heading", { name: "This session has ended" })).toBeVisible();
  await expect(page.getByText("Ask the host for the next session, or check back later.")).toBeVisible();
  await expect(page.getByPlaceholder("Your nickname")).toHaveCount(0);
});

test("PART-09: joining late on a content, a closed or a leaderboard slide shows that slide's state", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E late join ${Date.now()}`, [
    { type: "heading", content: { title: "Welcome aboard", subtitle: "" } },
    { type: "wordcloud", question: "One word for your week", timeLimit: 0, maxEntries: 3 },
    { type: "leaderboard", question: "Standings" },
  ]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(stage.getByText("SLIDE 1 OF 3")).toBeVisible();

  // Content slide: look at the screen.
  const ada = await joinMidSession(browser, contexts, deck.joinCode, "Ada");
  await expect(ada.page.getByText("Look at the screen")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Send Words" })).toHaveCount(0);

  // Closed slide: no answer form for someone who arrives after voting closed.
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 2 OF 3")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Send Words" })).toBeVisible();
  await hostPage.getByRole("button", { name: "Close voting" }).click();
  await expect(stage.getByText("Voting closed")).toBeVisible();
  const grace = await joinMidSession(browser, contexts, deck.joinCode, "Grace");
  await expect(grace.page.getByRole("heading", { name: "One word for your week" })).toBeVisible();
  await expect(grace.page.getByText("Voting is closed")).toBeVisible();
  await expect(grace.page.getByRole("button", { name: "Send Words" })).toHaveCount(0);
  await expect(grace.page.getByPlaceholder("Word 1 of 3…")).toHaveCount(0);

  // Leaderboard slide: the standings, with this phone's own row.
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 3 OF 3")).toBeVisible();
  const linus = await joinMidSession(browser, contexts, deck.joinCode, "Linus");
  await expect(linus.page.getByText("Leaderboard", { exact: true }).first()).toBeVisible();
  await expect(linus.page.getByText("You", { exact: true })).toBeVisible();
  await expect(linus.page.getByText("Linus", { exact: true }).first()).toBeVisible();
});

test("PART-30: the same device keeps its seat in a new tab and after losing its session credentials", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E same device ${Date.now()}`, [planets]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(stage.getByText("SLIDE 1 OF 1")).toBeVisible();

  const ada = await joinMidSession(browser, contexts, deck.joinCode, "Ada");
  await ada.page.getByRole("button", { name: /Mars/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();
  await expect(stage).toContainText(/1\s*\/\s*1\s*answered/);

  // The link again in a second tab of the same browser: still Ada, still answered, no nickname form.
  const secondTab = await ada.page.context().newPage();
  await secondTab.goto(`/live/${deck.joinCode}`);
  await expect(secondTab.getByText("Answer locked in!")).toBeVisible();
  await expect(secondTab.getByText("Ada", { exact: true })).toBeVisible();
  await expect(secondTab.getByPlaceholder("Your nickname")).toHaveCount(0);
  await secondTab.close();

  // The session credentials are gone (the device record stays): the form comes back with the
  // nickname filled in, and joining again takes the same seat, answer included.
  const [session] = await host.getSessions(deck._id);
  await ada.page.evaluate(
    (key) => window.localStorage.removeItem(key),
    `openpoll_participant_${deck.joinCode}_${session.sessionId}`
  );
  await ada.page.reload();
  await expect(ada.page.getByPlaceholder("Your nickname")).toHaveValue("Ada");
  await ada.page.getByRole("button", { name: "Join Session" }).click();
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  await expect(stage).toContainText(/1\s*\/\s*1\s*answered/);
  const [after] = await host.getSessions(deck._id);
  expect(after.participantCount).toBe(1);

  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(ada.page.getByText("Correct!")).toBeVisible();
});
