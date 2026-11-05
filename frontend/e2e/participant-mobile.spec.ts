import { devices, type Locator, type Page } from "@playwright/test";
import { endSession, expect, joinMidSession, test } from "./fixtures";

/**
 * The participant flow on a phone (UX-02): 375×812 with touch. A participant
 * types the code, picks a nickname, answers a multiple-choice, a word cloud and
 * a scales slide, and reaches the end screen. On every screen the page must not
 * scroll sideways, and the controls used to answer must be at least 44 px tall.
 * The host drives the deck from a desktop browser.
 */

test.use({
  viewport: { width: 375, height: 812 },
  screen: { width: 375, height: 812 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices["Pixel 5"].userAgent,
});

const DESKTOP = {
  viewport: devices["Desktop Chrome"].viewport,
  screen: { width: 1920, height: 1080 },
  userAgent: devices["Desktop Chrome"].userAgent,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

const MIN_TARGET = 44;

const SELECT = {
  type: "select_answer",
  question: "Which planet in our solar system is known as the Red Planet?",
  timeLimit: 120,
  options: [
    { text: "Mars, the fourth planet from the Sun", isCorrect: true },
    { text: "Venus", isCorrect: false },
    { text: "Jupiter", isCorrect: false },
  ],
};
const CLOUD = { type: "wordcloud", question: "One word for this week", timeLimit: 0, maxEntries: 3 };
const SCALES = {
  type: "scales",
  question: "Rate this session",
  timeLimit: 0,
  statements: ["The pace was right", "The examples helped me understand the topic"],
  scaleMax: 5,
  minLabel: "Disagree",
  maxLabel: "Agree",
};

// Within the 30-character limit, and long enough to stress the header.
const NICKNAME = "Ada_Lovelace_the_Countess";

async function expectNoHorizontalOverflow(page: Page, screen: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `${screen}: page is ${scrollWidth}px wide in a ${innerWidth}px viewport`).toBeLessThanOrEqual(
    innerWidth
  );
}

async function expectTapTarget(target: Locator, name: string, { soft = false } = {}) {
  await expect(target).toBeVisible();
  const height = async () => (await target.boundingBox())?.height ?? 0;
  // Chips scale in (0.8 → 1): measure once the entry animation has settled.
  await expect.poll(height, { timeout: 3_000 }).toBeGreaterThanOrEqual(MIN_TARGET).catch(() => {});
  const settled = await height();
  (soft ? expect.soft : expect)(settled, `${name} is ${settled}px tall`).toBeGreaterThanOrEqual(MIN_TARGET);
}

test("UX-02: a participant joins, answers three slide types and reaches the end on a phone", async ({
  browser,
  browserName,
  contexts,
  host,
}) => {
  // Playwright's Firefox has no touch emulation (no taps, maxTouchPoints 0). WebKit covers phones.
  test.skip(browserName === "firefox", "Firefox has no touch emulation");
  const deck = await host.createDeck(`E2E phone ${Date.now()}`, [SELECT, CLOUD, SCALES]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`, DESKTOP);
  const stage = hostPage.locator("main");
  await hostPage.getByRole("button", { name: "Open lobby" }).click();
  await expect(stage.getByText(deck.joinCode, { exact: true })).toBeVisible();

  const context = await browser.newContext();
  contexts.push(context);
  const phone = await context.newPage();

  // --- Join page: type the code ---
  await phone.goto("/live");
  await expect(phone.getByRole("heading", { name: "Join a live deck" })).toBeVisible();
  // A touch phone whose layout viewport is the device width (the page's viewport meta works).
  // WebKit exposes emulated touch through touch events, not maxTouchPoints.
  expect(
    await phone.evaluate(() => [window.innerWidth, navigator.maxTouchPoints > 0 || "ontouchstart" in window]),
  ).toEqual([375, true]);
  await expectNoHorizontalOverflow(phone, "join page");
  const code = phone.getByPlaceholder("000000");
  await expectTapTarget(code, "code field");
  await code.tap();
  await code.fill(deck.joinCode);
  const join = phone.getByRole("button", { name: "Join", exact: true });
  await expectTapTarget(join, "Join");
  await join.tap();

  // --- Nickname ---
  const nickname = phone.getByPlaceholder("Your nickname");
  await expect(nickname).toBeVisible();
  await expectNoHorizontalOverflow(phone, "nickname form");
  await expectTapTarget(nickname, "nickname field");
  await nickname.fill(NICKNAME);
  const joinSession = phone.getByRole("button", { name: "Join Session" });
  await expectTapTarget(joinSession, "Join Session");
  await joinSession.tap();

  // --- Lobby ---
  await expect(phone.getByRole("heading", { name: "You're in!" })).toBeVisible();
  await expect(phone.getByText(NICKNAME, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(phone, "lobby");
  await expect(stage.getByText("1 JOINED")).toBeVisible();
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();

  // --- Slide 1: multiple choice ---
  await expect(phone.getByRole("heading", { name: SELECT.question })).toBeVisible();
  await expect(phone.getByText("Slide 1 of 3")).toBeVisible();
  const options = SELECT.options.map((o) => phone.getByRole("button", { name: o.text }));
  for (const [i, option] of options.entries()) await expectTapTarget(option, `option ${i + 1}`);
  const submitAnswer = phone.getByRole("button", { name: "Submit Answer" });
  await expectTapTarget(submitAnswer, "Submit Answer");
  await expectNoHorizontalOverflow(phone, "multiple choice");
  await options[0].tap();
  await submitAnswer.tap();
  await expect(phone.getByText("Answer locked in!")).toBeVisible();
  await expect(stage).toContainText(/1\s*\/\s*1\s*answered/);
  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(phone.getByText("Correct!")).toBeVisible();
  await expectNoHorizontalOverflow(phone, "multiple choice result");

  // --- Slide 2: word cloud ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(phone.getByRole("heading", { name: CLOUD.question })).toBeVisible();
  const word = phone.getByPlaceholder("Word 1 of 3…");
  await expectTapTarget(word, "word field");
  const add = phone.getByRole("button", { name: "Add", exact: true });
  await expectTapTarget(add, "Add");
  const sendWords = phone.getByRole("button", { name: "Send Words" });
  await expectTapTarget(sendWords, "Send Words");
  await word.fill("focused");
  await add.tap();
  await expect(phone.getByRole("button", { name: "Remove focused" })).toBeVisible();
  await phone.getByPlaceholder("Word 2 of 3…").fill("curious");
  await expectNoHorizontalOverflow(phone, "word cloud");
  await sendWords.tap();
  await expect(phone.getByText("Response received!")).toBeVisible();
  await expect(stage.getByText("focused", { exact: true })).toBeVisible();
  await expect(stage.getByText("curious", { exact: true })).toBeVisible();

  // --- Slide 3: scales ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(phone.getByRole("heading", { name: SCALES.question })).toBeVisible();
  const sliders = phone.getByRole("slider");
  await expect(sliders).toHaveCount(2);
  const submitRatings = phone.getByRole("button", { name: "Submit Ratings" });
  await expectTapTarget(submitRatings, "Submit Ratings");
  await expectNoHorizontalOverflow(phone, "scales");
  await sliders.first().fill("5");
  await submitRatings.tap();
  await expect(phone.getByText("Response received!")).toBeVisible();
  await expect(stage).toContainText("5.0 / 5");

  // --- End ---
  await endSession(hostPage);
  await expect(phone.getByRole("heading", { name: "That's a wrap!" })).toBeVisible();
  await expect(phone.getByText(/You finished\s*#1/)).toBeVisible();
  await expect(phone.getByText("Final standings")).toBeVisible();
  await expectNoHorizontalOverflow(phone, "end screen");
});

test("UX-02: the remove-word chip and the rating sliders are 44 px touch targets", async ({ browser, contexts, host }) => {
  const deck = await host.createDeck(`E2E phone targets ${Date.now()}`, [CLOUD, SCALES]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`, DESKTOP);
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(hostPage.locator("main").getByText("SLIDE 1 OF 2")).toBeVisible();

  const { page: phone } = await joinMidSession(browser, contexts, deck.joinCode, "Grace");
  await expect(phone.getByRole("heading", { name: CLOUD.question })).toBeVisible();
  await phone.getByPlaceholder("Word 1 of 3…").fill("focused");
  await phone.getByRole("button", { name: "Add", exact: true }).tap();
  await expectTapTarget(phone.getByRole("button", { name: "Remove focused" }), "Remove focused", { soft: true });
  await phone.getByRole("button", { name: "Send Words" }).tap();
  await expect(phone.getByText("Response received!")).toBeVisible();

  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(phone.getByRole("heading", { name: SCALES.question })).toBeVisible();
  for (const statement of SCALES.statements) {
    await expectTapTarget(phone.getByRole("slider", { name: statement }), `slider "${statement}"`, { soft: true });
  }
});
