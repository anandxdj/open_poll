import { e2eEnv } from "./env";
import { endSession, expect, joinAsParticipant, test, type Participant } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * W2-A presenter experience, through real clicks: the presenter view with the
 * audience window it keeps in step (two pages, BroadcastChannel), removing a
 * participant, pausing and extending the timer as the phone sees it, and a
 * second browser context as the phone remote driving next and reveal.
 */

const NOTE = "Ask who has been to Paris before revealing.";

const capital = {
  type: "select_answer",
  question: "What is the capital of France?",
  notes: NOTE,
  timeLimit: 120,
  options: [
    { text: "Paris", isCorrect: true },
    { text: "Lyon", isCorrect: false },
  ],
};
const heading = { type: "heading", content: { title: "Halfway there", subtitle: "Take a breath" }, notes: "Breathe." };
const planets = {
  type: "select_answer",
  question: "Which planet is known as the Red Planet?",
  timeLimit: 60,
  options: [
    { text: "Mars", isCorrect: true },
    { text: "Venus", isCorrect: false },
  ],
};

const answer = async ({ page }: Participant, option: RegExp) => {
  await page.getByRole("button", { name: option }).click();
  await page.getByRole("button", { name: "Submit Answer" }).click();
};

/** Presenter view: opens the lobby from the stage's "Ready to present" screen. */
async function openLobbyIn(page: Page, joinCode: string) {
  await page.getByRole("button", { name: "Open lobby" }).click();
  await expect(page.locator("main").getByText(joinCode, { exact: true })).toBeVisible();
}

/** Seconds shown by a running or paused countdown bar (`12s`). */
async function secondsShown(page: Page) {
  const text = await page.getByTestId("countdown").locator(".font-mono").first().innerText();
  return Number(text.replace(/\D/g, ""));
}

test("the presenter view shows notes and the next slide, and the audience window follows it", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E presenter ${Date.now()}`, [capital, heading, planets]);
  const presenter = await host.open(`/presentation/${deck._id}/presenter`);
  const stage = presenter.locator("main");

  // Before the run: the first slide's notes and preview, nothing live yet.
  await expect(presenter.getByTestId("speaker-notes")).toHaveText(NOTE);
  await expect(presenter.getByTestId("next-slide-preview")).toContainText(capital.question);
  await expect(stage.getByText("Ready to present")).toBeVisible();

  // The audience window opens from the presenter view and mirrors its stage. The button's
  // window.open call is recorded rather than followed: GitHub's headless Chromium crashes the
  // renderer on this popup (CI only, every run since PR #20; it passes locally in both the system
  // Chromium and the bundled headless shell). The window is opened as a second tab of the same
  // browser context instead, which shares the BroadcastChannel exactly as the popup does.
  await presenter.evaluate(() => {
    const calls: Array<[string, string, string]> = [];
    (window as unknown as { __openCalls: typeof calls }).__openCalls = calls;
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      calls.push([String(url), String(target), String(features)]);
      return { closed: false, focus: () => {} } as unknown as Window;
    }) as typeof window.open;
  });
  await presenter.getByRole("button", { name: "Open audience window" }).click();
  const openCalls = await presenter.evaluate(
    () => (window as unknown as { __openCalls: Array<[string, string, string]> }).__openCalls,
  );
  expect(openCalls).toHaveLength(1);
  const [audienceUrl, , audienceFeatures] = openCalls[0];
  expect(audienceUrl).toContain(`/presentation/${deck._id}/present`);
  expect(audienceFeatures).toContain("popup");
  const audience = await presenter.context().newPage();
  await audience.goto(audienceUrl);
  const screen = audience.locator("main");
  await expect(screen.getByText("Ready to present")).toBeVisible();
  await expect(presenter.getByRole("button", { name: "Audience window open" })).toBeVisible();
  // The projected screen never shows the presenter's chrome or notes.
  await expect(audience.getByText(NOTE)).toHaveCount(0);
  await expect(audience.getByRole("button", { name: "Start presenting" })).toHaveCount(0);
  await expect(audience.getByRole("button", { name: /Fullscreen/ })).toHaveCount(1);

  await openLobbyIn(presenter, deck.joinCode);
  await expect(screen.getByText(deck.joinCode, { exact: true })).toBeVisible();
  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  await expect(screen.getByText("1 joined")).toBeVisible();
  await expect(presenter.getByTestId("participant-count")).toHaveText("1 joined");

  await presenter.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByText("Slide 1 of 3")).toBeVisible();
  await expect(screen.getByRole("heading", { name: capital.question })).toBeVisible();
  await expect(screen.getByText("Voting open")).toBeVisible();
  await expect(presenter.getByTestId("speaker-notes")).toHaveText(NOTE);
  await expect(presenter.getByTestId("next-slide-preview")).toContainText("Halfway there");
  await expect(presenter.getByTestId("session-elapsed")).toHaveText(/^\d\d:\d\d$/);

  await answer(ada, /Paris/);
  await expect(presenter.getByTestId("presenter-responses")).toHaveText("1 of 1");
  await expect(screen).toContainText(/1\s*\/\s*1\s*answered/);
  await presenter.getByRole("button", { name: "Reveal" }).click();
  await expect(screen.getByText("Results revealed")).toBeVisible();
  await expect(ada.page.getByText("Correct!")).toBeVisible();

  // Next (button) and back (arrow key): the audience window follows each move.
  await presenter.getByRole("button", { name: "Next Slide" }).click();
  await expect(screen.getByRole("heading", { name: "Halfway there" })).toBeVisible();
  await expect(presenter.getByTestId("speaker-notes")).toHaveText("Breathe.");
  await expect(presenter.getByTestId("next-slide-preview")).toContainText(planets.question);
  await presenter.keyboard.press("ArrowLeft");
  await expect(screen.getByRole("heading", { name: capital.question })).toBeVisible();
  await expect(screen.getByText("Results revealed")).toBeVisible();

  // A reload of the audience window catches up from the presenter view.
  await audience.reload();
  await expect(audience.locator("main").getByRole("heading", { name: capital.question })).toBeVisible();

  await presenter.keyboard.press("ArrowRight");
  await expect(audience.locator("main").getByRole("heading", { name: "Halfway there" })).toBeVisible();
  await presenter.keyboard.press("ArrowRight");
  await expect(audience.locator("main").getByRole("heading", { name: planets.question })).toBeVisible();
  await endSession(presenter);
  await expect(audience.locator("main").getByText("Session ended")).toBeVisible();
});

test("removing a participant: their phone says so, stays out after a reload, the others go on", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E kick ${Date.now()}`, [capital, planets]);
  const presenter = await host.open(`/presentation/${deck._id}/presenter`);
  await openLobbyIn(presenter, deck.joinCode);
  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const troll = await joinAsParticipant(browser, contexts, deck.joinCode, "Troll");
  await expect(presenter.getByTestId("participant-count")).toHaveText("2 joined");
  await presenter.getByRole("button", { name: "Start", exact: true }).click();
  await expect(troll.page.getByRole("button", { name: "Submit Answer" })).toBeVisible();

  // The app's own dialog asks first; Keep them does nothing.
  await presenter.getByRole("button", { name: "Remove Troll" }).click();
  const dialog = presenter.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Remove Troll?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Keep them" }).click();
  await expect(presenter.getByTestId("participant-count")).toHaveText("2 joined");

  await presenter.getByRole("button", { name: "Remove Troll" }).click();
  await presenter.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(presenter.getByText("Troll was removed from the session.")).toBeVisible();
  await expect(presenter.getByTestId("participant-count")).toHaveText("1 joined");
  await expect(presenter.getByRole("button", { name: "Remove Troll" })).toHaveCount(0);

  await expect(troll.page.getByRole("heading", { name: "You were removed from this session" })).toBeVisible();
  await expect(troll.page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  await troll.page.reload();
  await expect(troll.page.getByRole("heading", { name: "You were removed from this session" })).toBeVisible();
  await expect(troll.page.getByPlaceholder("Your nickname")).toHaveCount(0);

  // The others are not affected.
  await answer(ada, /Paris/);
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();
  await expect(presenter.getByTestId("presenter-responses")).toHaveText("1 of 1");
});

test("pausing and extending the timer: the phone and the stage show the frozen and extended time", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E timer ${Date.now()}`, [planets]);
  const presenter = await host.open(`/presentation/${deck._id}/presenter`);
  const stage = presenter.locator("main");
  await openLobbyIn(presenter, deck.joinCode);
  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  await presenter.getByRole("button", { name: "Start", exact: true }).click();
  await expect(ada.page.getByText("Time left")).toBeVisible();

  await presenter.getByRole("button", { name: "Pause timer" }).click();
  await expect(presenter.getByRole("button", { name: "Resume timer" })).toBeVisible();
  await expect(presenter.getByTestId("presenter-timer")).toHaveText("Timer paused");
  await expect(stage.getByText("Paused", { exact: true })).toBeVisible();
  await expect(ada.page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(ada.page.getByText("The presenter paused the timer. You can send your answer when it resumes.")).toBeVisible();
  const frozen = await secondsShown(ada.page);
  expect(frozen).toBeGreaterThan(50);
  expect(frozen).toBeLessThanOrEqual(60);
  // Frozen: the same value two seconds later.
  await ada.page.waitForTimeout(2000);
  expect(await secondsShown(ada.page)).toBe(frozen);

  // Sending while paused waits: the phone says so and nothing is counted.
  await answer(ada, /Mars/);
  await expect(ada.page.getByRole("button", { name: "Submit Answer" })).toBeVisible();
  await expect(presenter.getByTestId("presenter-responses")).toHaveText("0 of 1");

  // +30 s while paused grows the frozen time on the phone and the stage.
  await presenter.getByRole("button", { name: "Add 30 seconds" }).click();
  await expect.poll(() => secondsShown(ada.page)).toBe(frozen + 30);
  await expect.poll(() => secondsShown(presenter)).toBe(frozen + 30);

  await presenter.getByRole("button", { name: "Resume timer" }).click();
  await expect(ada.page.getByText("Time left")).toBeVisible();
  await expect(ada.page.getByText("Paused", { exact: true })).toHaveCount(0);
  await expect.poll(() => secondsShown(ada.page), { timeout: 5000 }).toBeLessThan(frozen + 30);

  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();
  await expect(presenter.getByTestId("presenter-responses")).toHaveText("1 of 1");

  // Skip: time's up now; the scored slide reveals itself.
  await presenter.getByRole("button", { name: "Skip timer" }).click();
  await expect(stage.getByText("Results revealed")).toBeVisible({ timeout: 10_000 });
  await expect(ada.page.getByText("Correct!")).toBeVisible();
});

test("a phone remote pairs by link, drives next and reveal, and stops when unpaired", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E remote ${Date.now()}`, [capital, heading]);
  const presenter = await host.open(`/presentation/${deck._id}/presenter`);
  const stage = presenter.locator("main");
  await expect(presenter.getByTestId("remote-status")).toHaveText("Not paired");

  await presenter.getByRole("button", { name: "Pair a phone" }).click();
  await expect(presenter.getByRole("img", { name: "Phone remote link" })).toBeVisible();
  const link = (await presenter.getByTestId("remote-link").innerText()).trim();
  expect(link.startsWith(`${e2eEnv.frontendUrl}/remote/rt1.`)).toBe(true);
  await expect(presenter.getByTestId("remote-status")).toHaveText("Waiting for a phone to scan");

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(phoneContext);
  const remote = await phoneContext.newPage();
  await remote.goto(link);
  await expect(remote.getByTestId("remote-link-status")).toHaveText("Connected");
  await expect(remote.getByText("Not started yet. Start presenting from the presenter view.")).toBeVisible();
  await expect(presenter.getByTestId("remote-status")).toHaveText("Phone connected");

  // A second phone with the same link is refused: the first one bound it.
  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(otherContext);
  const other = await otherContext.newPage();
  await other.goto(link);
  await expect(other.getByRole("heading", { name: "This remote is paired with another phone" })).toBeVisible();

  await openLobbyIn(presenter, deck.joinCode);
  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  await expect(remote.getByText("Lobby open, 1 joined. Next starts the first slide.")).toBeVisible();

  // Next from the phone starts the first slide on the presenter view and the phones.
  await remote.getByRole("button", { name: "Next", exact: true }).click();
  await expect(stage.getByText("Slide 1 of 2")).toBeVisible();
  await expect(remote.getByTestId("remote-slide-title")).toHaveText(capital.question);
  await expect(remote.getByTestId("remote-notes")).toHaveText(NOTE);
  await expect(remote.getByTestId("remote-phase")).toHaveText("Voting open");

  // Pause and +30 s from the phone reach the stage.
  await remote.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(remote.getByTestId("remote-timer")).toHaveText("Paused");
  await expect(stage.getByText("Paused", { exact: true })).toBeVisible();
  await remote.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(stage.getByText("Time left")).toBeVisible();

  await answer(ada, /Paris/);
  await expect(remote.getByText("1 of 1 answered")).toBeVisible();
  await remote.getByRole("button", { name: "Reveal", exact: true }).click();
  await expect(stage.getByText("Results revealed")).toBeVisible();
  await expect(remote.getByTestId("remote-phase")).toHaveText("Results revealed");
  await expect(ada.page.getByText("Correct!")).toBeVisible();

  await remote.getByRole("button", { name: "Next", exact: true }).click();
  await expect(stage.getByRole("heading", { name: "Halfway there" })).toBeVisible();
  await expect(remote.getByRole("button", { name: "Next", exact: true })).toBeDisabled();

  // Unpairing drops the phone at once.
  await presenter.getByRole("button", { name: "Unpair" }).click();
  await expect(remote.getByRole("heading", { name: "The presenter unpaired this remote" })).toBeVisible();
  await expect(presenter.getByTestId("remote-status")).toHaveText("Not paired");
  await remote.reload();
  await expect(remote.getByRole("heading", { name: "This remote link no longer works" })).toBeVisible();
});
