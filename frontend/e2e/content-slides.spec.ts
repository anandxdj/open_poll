import type { Page } from "@playwright/test";
import { expect, joinAsParticipant, test, type Participant } from "./fixtures";

/**
 * Content slides live (W1-D): a content-only deck presented fullscreen, and a
 * mixed deck (heading → word cloud → select answer) clicked through with two
 * participants. Third-party media (image host, YouTube player) is answered
 * locally, so the run needs no network.
 */

const IMAGE_URL = "https://images.e2e.test/team.png";
// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function stubThirdPartyMedia(page: Page) {
  await page.route("https://images.e2e.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG })
  );
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title>" })
  );
}

const CONTENT_DECK = [
  { type: "heading", content: { title: "Welcome to Open Poll", subtitle: "Quarterly kick-off" } },
  {
    type: "paragraph",
    content: {
      title: "Why we are here",
      body: "We **ship** every week. Read [the plan](https://example.com/plan).\n\nQuestions welcome.",
    },
  },
  { type: "bullets", content: { title: "Agenda", items: ["Wins", "Roadmap", "Q&A"] } },
  { type: "image", content: { url: IMAGE_URL, alt: "The team on stage", fit: "contain", caption: "Berlin, 2026" } },
  { type: "big_number", content: { value: 87.5, label: "of teams ship weekly", prefix: "", suffix: "%" } },
  { type: "quote", content: { text: "The best way to predict the future is to invent it.", attribution: "Alan Kay" } },
  { type: "video", content: { provider: "youtube", id: "dQw4w9WgXcQ", start: 30 } },
  { type: "instructions", content: { showQr: true, showCode: true, text: "Grab your phone for the quiz" } },
];

test("a content-only deck is presented fullscreen", async ({ browser, contexts, host }) => {
  const deck = await host.createDeck(`E2E content deck ${Date.now()}`, CONTENT_DECK);

  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await stubThirdPartyMedia(hostPage);
  const stage = hostPage.locator("main");
  await expect(stage.getByText(deck.joinCode, { exact: true })).toBeVisible();

  // The lobby's Start needs someone in the room (no-lobby start lands with W1-A1).
  await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  await expect(stage.getByText("1 JOINED")).toBeVisible();
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();

  // F puts the console in fullscreen, as a presenter would.
  await expect(stage.getByText("SLIDE 1 OF 8")).toBeVisible();
  await hostPage.keyboard.press("f");
  await expect.poll(() => hostPage.evaluate(() => document.fullscreenElement !== null)).toBe(true);

  // 1 — heading
  await expect(stage.getByRole("heading", { name: "Welcome to Open Poll" })).toBeVisible();
  await expect(stage.getByText("Quarterly kick-off")).toBeVisible();
  await expect(stage.getByText("Time left")).toHaveCount(0);

  // 2 — paragraph (markdown-lite), advanced with the arrow key
  await hostPage.keyboard.press("ArrowRight");
  await expect(stage.getByText("SLIDE 2 OF 8")).toBeVisible();
  await expect(stage.getByRole("heading", { name: "Why we are here" })).toBeVisible();
  await expect(stage.locator("strong", { hasText: "ship" })).toBeVisible();
  await expect(stage.getByRole("link", { name: "the plan" })).toHaveAttribute("href", "https://example.com/plan");
  await expect(stage.getByText("Questions welcome.")).toBeVisible();

  // 3 — bullets
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(stage.getByRole("listitem")).toHaveText(["Wins", "Roadmap", "Q&A"]);

  // 4 — image with alt text and caption
  await hostPage.keyboard.press("ArrowRight");
  const image = stage.getByRole("img", { name: "The team on stage" });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", IMAGE_URL);
  await expect(stage.getByText("Berlin, 2026")).toBeVisible();

  // 5 — big number (counts up to its value)
  await hostPage.keyboard.press("ArrowRight");
  await expect(stage.getByText("of teams ship weekly")).toBeVisible();
  await expect(stage.getByText("87.5", { exact: true }).first()).toBeVisible();
  await expect(stage.getByText("%", { exact: true })).toBeVisible();

  // 6 — quote
  await hostPage.keyboard.press("ArrowRight");
  await expect(stage.locator("blockquote")).toHaveText("The best way to predict the future is to invent it.");
  await expect(stage.getByText("— Alan Kay")).toBeVisible();

  // 7 — video through the privacy-enhanced YouTube player
  await hostPage.keyboard.press("ArrowRight");
  const player = stage.locator('iframe[title="YouTube video"]');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=30");

  // 8 — how to join, with this session's code
  await hostPage.keyboard.press("ArrowRight");
  await expect(stage.getByText("SLIDE 8 OF 8")).toBeVisible();
  await expect(stage.getByText(deck.joinCode, { exact: true })).toBeVisible();
  await expect(stage.getByText("Grab your phone for the quiz")).toBeVisible();
  await expect(stage.getByRole("img", { name: "Scan to join" })).toBeVisible();

  // F again leaves fullscreen; the last slide offers to end the session.
  await hostPage.keyboard.press("f");
  await expect.poll(() => hostPage.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();
});

// Short timers keep the run fast; reveal fires on the host when they expire.
const TIME_LIMIT = 10;
const REVEAL_TIMEOUT = (TIME_LIMIT + 10) * 1000;

const CLOUD_QUESTION = "One word for this sprint";
const SELECT_QUESTION = "Which day do we release?";

const MIXED_DECK = [
  { type: "heading", content: { title: "Sprint retro", subtitle: "Two quick questions" } },
  { type: "wordcloud", question: CLOUD_QUESTION, timeLimit: TIME_LIMIT, maxEntries: 3 },
  {
    type: "select_answer",
    question: SELECT_QUESTION,
    timeLimit: TIME_LIMIT,
    options: [
      { text: "Tuesday", isCorrect: true },
      { text: "Friday", isCorrect: false },
    ],
  },
];

const forBoth = (players: Participant[], fn: (p: Participant) => Promise<void>) => Promise.all(players.map(fn));

test("a mixed deck (heading, word cloud, select answer) is clicked through live", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E mixed deck ${Date.now()}`, MIXED_DECK);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await expect(stage.getByText(deck.joinCode, { exact: true })).toBeVisible();

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  const players = [ada, grace];
  await expect(stage.getByText("2 JOINED")).toBeVisible();

  // --- Slide 1: heading — shown, no timer, nothing to answer ---
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByText("SLIDE 1 OF 3")).toBeVisible();
  await expect(stage.getByRole("heading", { name: "Sprint retro" })).toBeVisible();
  await expect(stage.getByText("Two quick questions")).toBeVisible();
  await expect(stage.getByText("Time left")).toHaveCount(0);

  // --- Slide 2: word cloud ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 2 OF 3")).toBeVisible();
  await expect(stage.getByRole("heading", { name: CLOUD_QUESTION })).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: CLOUD_QUESTION })).toBeVisible();
    await expect(page.getByText("Slide 2 of 3")).toBeVisible();
  });
  await ada.page.getByPlaceholder("Word 1 of 3…").fill("focused");
  await ada.page.getByRole("button", { name: "Send Words" }).click();
  await grace.page.getByPlaceholder("Word 1 of 3…").fill("focused");
  await grace.page.getByRole("button", { name: "Add" }).click();
  await grace.page.getByPlaceholder("Word 2 of 3…").fill("fast");
  await grace.page.getByRole("button", { name: "Send Words" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Response received!")).toBeVisible();
  });
  await expect(stage.getByText("focused", { exact: true })).toBeVisible();
  await expect(stage.getByText("fast", { exact: true })).toBeVisible();
  await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);
  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Waiting for host to advance…")).toBeVisible({ timeout: REVEAL_TIMEOUT });
  });

  // --- Slide 3: select answer (scored) ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 3 OF 3")).toBeVisible();
  await expect(stage.getByRole("heading", { name: SELECT_QUESTION })).toBeVisible();
  await ada.page.getByRole("button", { name: /Tuesday/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await grace.page.getByRole("button", { name: /Friday/ }).click();
  await grace.page.getByRole("button", { name: "Submit Answer" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Answer locked in!")).toBeVisible();
  });
  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await expect(ada.page.getByText("Correct!")).toBeVisible({ timeout: REVEAL_TIMEOUT });
  await expect(grace.page.getByText("Not quite…")).toBeVisible({ timeout: REVEAL_TIMEOUT });

  // --- End ---
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: "That's a wrap!" })).toBeVisible();
  });
  await expect(ada.page.getByText(/You finished\s*#1/)).toBeVisible();
});
