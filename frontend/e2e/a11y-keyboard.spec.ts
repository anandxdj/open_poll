import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * W4-A keyboard, focus, announcements, motion, zoom and touch targets, with
 * real keys and clicks:
 * - a phone joins and answers by keyboard alone; focus lands on each new
 *   screen's heading; the announcer says the slide, the answer accepted and the
 *   result; the timer is a named role="timer" that announces milestones only;
 * - the host's leaderboard dialog and End session dialog trap focus, close on
 *   Escape and give focus back; the presenter view's Q&A drawer takes focus
 *   and gives it back;
 * - ranking moves by keyboard keep focus on the item and announce its place;
 * - reduced motion stops CSS animations on the live surfaces;
 * - 320 px phones and 200 % zoom (1280×720 at 200 % = 640×360) never scroll
 *   sideways; every control on a phone is at least 44×44 px.
 */

const PHONE = { width: 390, height: 844 };

const QUIZ = {
  type: "select_answer",
  question: "What is the capital of France?",
  timeLimit: 13,
  points: 1000,
  options: [
    { text: "Paris", isCorrect: true },
    { text: "Lyon", isCorrect: false },
  ],
};
const RANKING = { type: "ranking", question: "Rank the features", timeLimit: 0, items: ["Speed", "Docs", "Themes"] };

async function phone(browser: Browser, contexts: BrowserContext[], options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext({ viewport: PHONE, ...options });
  contexts.push(context);
  return context.newPage();
}

const polite = (page: Page) => page.getByTestId("announcer-polite");

/** Presses Tab until `target` has focus (at most `max` times); fails when it never does. */
async function tabTo(page: Page, target: Locator, max = 25) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/** Every visible, enabled control inside `scope` smaller than 44×44 CSS px. */
async function smallTargets(scope: Locator) {
  return scope.evaluate((root) => {
    const controls = root.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="checkbox"], [role="slider"], [tabindex="0"]'
    );
    const small: string[] = [];
    for (const el of controls) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if ((el as HTMLButtonElement).disabled) continue;
      // A checkbox or radio inside its label: the label is the target.
      const label = el.closest("label");
      const target = label && (el as HTMLInputElement).type?.match(/checkbox|radio/) ? label.getBoundingClientRect() : box;
      if (target.height < 43.5 || target.width < 43.5) {
        small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(target.width)}×${Math.round(target.height)}`);
      }
    }
    return small;
  });
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("a phone joins and answers by keyboard; focus, announcements and the timer follow", async ({ browser, contexts, host }) => {
  test.setTimeout(150_000);
  const deck = await host.createDeck(
    `E2E a11y keyboard ${Date.now()}`,
    [QUIZ, { type: "heading", content: { title: "Halfway there" } }, RANKING],
    { theme: { mode: "light" } }
  );
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await hostPage.getByRole("button", { name: "Open lobby" }).click();
  await expect(stage.getByText(deck.joinCode, { exact: true })).toBeVisible();

  // --- Join by keyboard: the nickname field has focus, Enter joins, focus lands on "You're in!" ---
  const ada = await phone(browser, contexts);
  await ada.goto(`/live/${deck.joinCode}`);
  await expect(ada.getByRole("textbox", { name: "Your nickname" })).toBeFocused();
  await ada.keyboard.type("Ada");
  await ada.keyboard.press("Enter");
  await expect(ada.getByRole("heading", { name: "You're in!" })).toBeFocused();
  expect(await smallTargets(ada.locator("body"))).toEqual([]);

  // --- A new slide: focus on its heading, the announcer says where we are, a named timer ---
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  const question = ada.getByRole("heading", { name: QUIZ.question });
  await expect(question).toBeFocused();
  await expect(polite(ada)).toHaveText("New slide, 1 of 3");
  const timer = ada.getByRole("timer", { name: "Time left" });
  await expect(timer).toBeVisible();
  await expect(timer).toHaveAttribute("aria-live", "off");
  await expect(stage.getByRole("timer", { name: "Time left" })).toBeVisible();
  expect(await smallTargets(ada.locator("main"))).toEqual([]);

  // Shortcuts work inside the option list only: "B" from the heading does nothing.
  await ada.keyboard.press("b");
  await expect(ada.getByRole("button", { name: /Lyon/ })).toHaveAttribute("aria-pressed", "false");
  await tabTo(ada, ada.getByRole("button", { name: /Paris/ }));
  await ada.keyboard.press("b");
  await expect(ada.getByRole("button", { name: /Lyon/ })).toHaveAttribute("aria-pressed", "true");
  await ada.keyboard.press("a");
  await expect(ada.getByRole("button", { name: /Paris/ })).toHaveAttribute("aria-pressed", "true");
  await tabTo(ada, ada.getByRole("button", { name: "Submit Answer" }));
  await ada.keyboard.press("Enter");
  // The form is gone: focus moves onto the new state instead of being lost.
  await expect(ada.getByText("Answer locked in!")).toBeVisible();
  await expect(ada.getByTestId("participant-slide-state")).toBeFocused();

  // The timer says its milestones, not every second (13 s → "10 seconds left" once).
  await expect(ada.getByTestId("timer-announcement")).toHaveText("10 seconds left", { timeout: 8000 });
  await ada.waitForTimeout(1500);
  await expect(ada.getByTestId("timer-announcement")).toHaveText("10 seconds left");

  // The (auto) reveal: the result is announced with the points and the rank; icon + words, not colour alone.
  await expect(ada.getByText("Correct!")).toBeVisible({ timeout: 20_000 });
  await expect(polite(ada)).toHaveText(/^Right answer, [\d,]+ points\. You are number 1 with [\d,]+ points\.$/);
  await expect(ada.getByTestId("participant-slide-state").locator("svg").first()).toBeVisible();
  await expect(stage.getByRole("status").filter({ hasText: "Results revealed" })).toBeVisible();

  // --- A content slide: focus on "Look at the screen" ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(ada.getByRole("heading", { name: "Look at the screen" })).toBeFocused();
  await expect(polite(ada)).toHaveText("New slide, 2 of 3");

  // --- Ranking by keyboard: focus stays on the moved item, its new place is announced ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(ada.getByRole("heading", { name: RANKING.question })).toBeFocused();
  await tabTo(ada, ada.getByRole("button", { name: "Move Speed down" }));
  await ada.keyboard.press("Enter");
  await expect(ada.getByText("Speed is now number 2")).toBeAttached();
  await expect(ada.getByRole("button", { name: "Move Speed down" })).toBeFocused();
  await ada.keyboard.press("Enter");
  await expect(ada.getByText("Speed is now number 3")).toBeAttached();
  // At the bottom, "down" is disabled: focus moved to the same item's "up".
  await expect(ada.getByRole("button", { name: "Move Speed up" })).toBeFocused();
  expect(await ada.getByRole("listitem").allInnerTexts()).toEqual([
    expect.stringContaining("Docs"),
    expect.stringContaining("Themes"),
    expect.stringContaining("Speed"),
  ]);
  expect(await smallTargets(ada.locator("main"))).toEqual([]);
  await tabTo(ada, ada.getByRole("button", { name: "Submit Ranking" }));
  await ada.keyboard.press("Enter");
  await expect(ada.getByText("Response received!")).toBeVisible();

  // --- End: focus lands on the end screen's heading ---
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await hostPage.getByRole("alertdialog").getByRole("button", { name: "End session" }).click();
  await expect(ada.getByRole("heading", { name: "That's a wrap!" })).toBeFocused();
});

test("host dialogs trap focus, close on Escape and give focus back; the Q&A drawer too", async ({ host }) => {
  const deck = await host.createDeck(`E2E a11y dialogs ${Date.now()}`, [QUIZ, RANKING], {
    settings: { qna: { enabled: true, moderation: true } },
  });
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(hostPage.locator("main").getByRole("heading", { name: QUIZ.question })).toBeVisible();

  // Leaderboard: a modal dialog; Tab never leaves it; Escape closes it; focus returns to its button.
  const toggle = hostPage.locator("header").getByRole("button", { name: "Leaderboard" });
  await toggle.focus();
  await hostPage.keyboard.press("Enter");
  const dialog = hostPage.getByRole("dialog", { name: "Live Leaderboard" });
  await expect(dialog).toBeVisible();
  // Modal: the rest of the console is hidden from assistive tech while it is open.
  await expect(hostPage.locator('header button[aria-haspopup="dialog"]')).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveCount(0);
  for (let i = 0; i < 4; i++) {
    await hostPage.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await hostPage.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(toggle).toBeFocused();

  // End session: the app's alert dialog; Escape keeps the session and focus goes back.
  const end = hostPage.getByRole("button", { name: "End Session" }).first();
  await end.focus();
  await hostPage.keyboard.press("Enter");
  const confirm = hostPage.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  expect(await confirm.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await hostPage.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(end).toBeFocused();
  await expect(hostPage.locator("main").getByRole("heading", { name: QUIZ.question })).toBeVisible();

  // Arrow keys still move the deck once the dialogs are closed.
  await hostPage.locator("main").click({ position: { x: 5, y: 5 } });
  await hostPage.keyboard.press("ArrowRight");
  await expect(hostPage.locator("main").getByRole("heading", { name: RANKING.question })).toBeVisible();

  // The Q&A drawer (host header) takes focus when it opens and gives it back on Escape.
  const qna = hostPage.getByRole("button", { name: "Open Q&A panel" });
  await expect(qna).toBeVisible();
  await qna.focus();
  await hostPage.keyboard.press("Enter");
  await expect(hostPage.getByRole("heading", { name: "Audience questions" })).toBeFocused();
  await hostPage.keyboard.press("Escape");
  await expect(hostPage.getByRole("button", { name: "Open Q&A panel" })).toBeFocused();
  // Its slide keys stayed off while it was open; the deck is still on slide 2.
  await expect(hostPage.locator("main").getByRole("heading", { name: RANKING.question })).toBeVisible();
});

test("reduced motion, 320 px phones and 200 % zoom", async ({ browser, contexts, host }) => {
  test.setTimeout(120_000);
  const deck = await host.createDeck(`E2E a11y reflow ${Date.now()}`, [{ ...QUIZ, timeLimit: 120 }, RANKING], {
    theme: { mode: "dark" },
  });

  // 200 % zoom of a 1280×720 window: the host console in 640×360 CSS px, no sideways scroll.
  const hostPage = await host.open(`/presentation/host/${deck._id}`, { viewport: { width: 640, height: 360 }, reducedMotion: "reduce" });
  await hostPage.getByRole("button", { name: "Open lobby" }).click();
  await expect(hostPage.locator("main").getByText(deck.joinCode, { exact: true })).toBeVisible();
  expect(await sideways(hostPage)).toBeLessThanOrEqual(0);

  // A 320 px phone with reduced motion: the join page, the lobby and an open question reflow.
  const ada = await phone(browser, contexts, { viewport: { width: 320, height: 640 }, reducedMotion: "reduce" });
  await ada.goto("/live");
  expect(await sideways(ada)).toBeLessThanOrEqual(0);
  await ada.goto(`/live/${deck.joinCode}`);
  await ada.getByRole("textbox", { name: "Your nickname" }).fill("Ada Lovelace-Byron");
  await ada.keyboard.press("Enter");
  await expect(ada.getByRole("heading", { name: "You're in!" })).toBeVisible();
  expect(await sideways(ada)).toBeLessThanOrEqual(0);

  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(ada.getByRole("heading", { name: QUIZ.question })).toBeVisible();
  expect(await sideways(ada)).toBeLessThanOrEqual(0);
  expect(await sideways(hostPage)).toBeLessThanOrEqual(0);
  // Reduced motion: the stage's entrance animation and the phone's pulses take no time.
  const durations = await hostPage.locator("main [class*='animate-in']").evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).animationDuration)
  );
  expect(durations.length).toBeGreaterThan(0);
  for (const duration of durations) expect(parseFloat(duration)).toBeLessThan(0.001);
  const pulses = await ada.locator("[class*='animate-pulse']").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationIterationCount));
  for (const count of pulses) expect(count).toBe("1");

  // The presenter view at 200 % zoom: its controls stay reachable without sideways scrolling.
  const presenter = await host.open(`/presentation/${deck._id}/presenter`, { viewport: { width: 640, height: 360 } });
  await expect(presenter.getByRole("button", { name: "Reveal" })).toBeVisible();
  expect(await sideways(presenter)).toBeLessThanOrEqual(0);
  await presenter.getByRole("button", { name: "Reveal" }).click();
  await expect(ada.getByText("Correct!")).toBeHidden();
  await expect(ada.getByText(/Time's up!|Voting is closed/)).toBeVisible();
  expect(await sideways(ada)).toBeLessThanOrEqual(0);

  // The phone remote on a 320 px phone.
  await presenter.getByRole("button", { name: "Pair a phone" }).click();
  const link = (await presenter.getByTestId("remote-link").innerText()).trim();
  const remote = await phone(browser, contexts, { viewport: { width: 320, height: 640 } });
  await remote.goto(link);
  await expect(remote.getByTestId("remote-link-status")).toHaveText("Connected");
  expect(await sideways(remote)).toBeLessThanOrEqual(0);
  expect(await smallTargets(remote.locator("body"))).toEqual([]);
});
