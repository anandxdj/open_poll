import type { Page } from "@playwright/test";
import { expect, joinAsParticipant, openLobby, test, type Participant } from "./fixtures";

/**
 * The advanced interactive slide types (W2-E): a deck with guess_number,
 * hundred_points, grid_2x2 and pin_on_image run live with two participants
 * (pointer and keyboard answers, reveal of each), and the builder editing and
 * saving all four. The slide image is answered locally, so the run needs no
 * network.
 */

const IMAGE_URL = "https://images.e2e.test/map.svg";
const IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#dbeafe"/><circle cx="300" cy="120" r="30" fill="#1d4ed8"/>
</svg>`;

async function stubImage(page: Page) {
  await page.route("https://images.e2e.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: IMAGE })
  );
}

// Short timers keep the run fast; each slide reveals on the host when its timer expires.
const TIME_LIMIT = 12;
const REVEAL_TIMEOUT = (TIME_LIMIT + 10) * 1000;

const GUESS = {
  type: "guess_number",
  question: "How many moons does Jupiter have?",
  timeLimit: TIME_LIMIT,
  points: 500,
  scoreDependsOnTime: false,
  config: { min: 0, max: 100, step: 1, correct: 79, tolerance: 3 },
};
const POINTS = {
  type: "hundred_points",
  question: "Where should we invest?",
  timeLimit: TIME_LIMIT,
  config: { items: ["Docs", "Tests", "Speed"] },
};
const GRID = {
  type: "grid_2x2",
  question: "Place the ideas",
  timeLimit: TIME_LIMIT,
  config: {
    items: ["Dark mode", "Offline"],
    x: { label: "Effort", min: 0, max: 10 },
    y: { label: "Impact", min: 0, max: 10 },
  },
};
const PIN = {
  type: "pin_on_image",
  question: "Where is Paris?",
  timeLimit: TIME_LIMIT,
  points: 300,
  scoreDependsOnTime: false,
  content: { url: IMAGE_URL, alt: "Map of France" },
  config: { region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } },
};

const forBoth = (players: Participant[], fn: (p: Participant) => Promise<void>) => Promise.all(players.map(fn));

test("guess, 100 points, 2x2 grid and pin slides run live and reveal", async ({ browser, contexts, host }) => {
  test.setTimeout(240_000);
  const deck = await host.createDeck(`E2E advanced slides ${Date.now()}`, [GUESS, POINTS, GRID, PIN]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  await stubImage(hostPage);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const linus = await joinAsParticipant(browser, contexts, deck.joinCode, "Linus");
  const players = [ada, linus];
  await Promise.all(players.map(({ page }) => stubImage(page)));
  await expect(stage.getByText("2 JOINED")).toBeVisible();

  // --- Slide 1: guess the number (graded, flat 500 points) ---
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByRole("heading", { name: GUESS.question })).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: GUESS.question })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Your guess" })).toHaveAttribute("max", "100");
  });
  // Ada types her guess; Linus uses the slider's keyboard.
  await ada.page.getByLabel("Or type your guess").fill("80");
  await ada.page.getByRole("button", { name: "Submit Guess" }).click();
  const slider = linus.page.getByRole("slider", { name: "Your guess" });
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(linus.page.getByTestId("guess-value")).toHaveText("2");
  await linus.page.getByRole("button", { name: "Submit Guess" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Answer locked in!")).toBeVisible();
  });
  // The stage fills a histogram without giving the answer away.
  await expect(stage.getByText("Guesses", { exact: true }).first()).toBeVisible();
  await expect(stage.getByRole("listitem").filter({ hasText: "1 guess" })).toHaveCount(2);
  await expect(stage.getByText("Correct answer")).toHaveCount(0);
  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await expect(stage.getByText("Correct answer")).toBeVisible();
  await expect(stage.getByText("79 ± 3")).toBeVisible();
  await expect(stage.getByText("1 of 2 guesses were correct")).toBeVisible();
  await expect(ada.page.getByText("Correct!")).toBeVisible({ timeout: REVEAL_TIMEOUT });
  await expect(ada.page.getByText("+500", { exact: true })).toBeVisible();
  await expect(linus.page.getByText("Not quite…")).toBeVisible({ timeout: REVEAL_TIMEOUT });

  // --- Slide 2: 100 points ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByRole("heading", { name: POINTS.question })).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("100 points left to give")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Points" })).toBeDisabled();
  });
  await ada.page.getByRole("spinbutton", { name: "Points for Docs" }).fill("50");
  await ada.page.getByRole("spinbutton", { name: "Points for Tests" }).fill("50");
  await expect(ada.page.getByText("All 100 points shared")).toBeVisible();
  await ada.page.getByRole("button", { name: "Submit Points" }).click();
  // Linus overshoots first: the form says so and refuses to submit.
  await linus.page.getByRole("spinbutton", { name: "Points for Docs" }).fill("60");
  await linus.page.getByRole("spinbutton", { name: "Points for Tests" }).fill("50");
  await expect(linus.page.getByText("10 points too many")).toBeVisible();
  await expect(linus.page.getByRole("button", { name: "Submit Points" })).toBeDisabled();
  await linus.page.getByRole("spinbutton", { name: "Points for Tests" }).fill("40");
  await expect(linus.page.getByText("All 100 points shared")).toBeVisible();
  await linus.page.getByRole("button", { name: "Submit Points" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Response received!")).toBeVisible();
  });
  // Averages: Docs 55, Tests 45, Speed 0.
  await expect(stage.getByText("2 participants answered")).toBeVisible();
  await expect(stage.getByText(/^55\s*avg$/)).toBeVisible();
  await expect(stage.getByText(/^45\s*avg$/)).toBeVisible();
  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await expect(stage.getByText("#1")).toBeVisible();
  await expect(stage.getByText("#1").locator("..")).toContainText("Docs");

  // --- Slide 3: 2x2 grid (Ada taps, Linus uses the keyboard) ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByRole("heading", { name: GRID.question })).toBeVisible();
  const boardOf = (page: Page) => page.getByRole("group", { name: /Grid with Effort across and Impact up/ });
  await forBoth(players, async ({ page }) => {
    await expect(boardOf(page)).toBeVisible();
    await expect(page.getByText("0 of 2 placed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Grid" })).toBeDisabled();
  });
  const board = boardOf(ada.page);
  const box = (await board.boundingBox())!;
  // Dark mode: low effort, high impact. Offline: high effort, low impact.
  await ada.page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await expect(ada.page.getByText("1 of 2 placed")).toBeVisible();
  // Placing an item hands the selection to the next one.
  await expect(ada.page.getByRole("button", { name: /Offline/ })).toHaveAttribute("aria-pressed", "true");
  await expect(ada.page.getByRole("button", { name: /Dark mode/ })).toHaveAttribute("aria-pressed", "false");
  await ada.page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect(ada.page.getByText("2 of 2 placed")).toBeVisible();
  await ada.page.getByRole("button", { name: "Submit Grid" }).click();
  const keyboardBoard = boardOf(linus.page);
  await keyboardBoard.focus();
  await keyboardBoard.press("Enter"); // places Dark mode in the middle
  await keyboardBoard.press("ArrowRight");
  await keyboardBoard.press("ArrowUp");
  await keyboardBoard.press("Enter"); // on to Offline
  await keyboardBoard.press("Enter"); // places it in the middle
  await keyboardBoard.press("ArrowLeft");
  await expect(linus.page.getByText("2 of 2 placed")).toBeVisible();
  await linus.page.getByRole("button", { name: "Submit Grid" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Response received!")).toBeVisible();
  });
  await expect(stage.getByText("2 participants answered")).toBeVisible();
  await expect(stage.getByText("Effort", { exact: true })).toBeVisible();
  await expect(stage.getByText("Impact", { exact: true })).toBeVisible();
  await expect(stage.locator("[data-marker]")).toHaveCount(2);
  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await expect(stage.locator("[data-marker]")).toHaveCount(2);

  // --- Slide 4: pin on image (graded, flat 300 points) ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByRole("heading", { name: PIN.question })).toBeVisible();
  const imageOf = (page: Page) => page.getByRole("group", { name: /Map of France/ });
  await forBoth(players, async ({ page }) => {
    await expect(imageOf(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Pin" })).toBeDisabled();
  });
  await expect(stage.getByRole("img", { name: "Map of France" })).toBeVisible();
  // Ada taps inside the correct area (x 40–60 %, y 20–40 %); Linus drops his pin below it by keyboard.
  const frame = imageOf(ada.page);
  // The picture has loaded once the frame has taken its size.
  await expect.poll(() => frame.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(100);
  const frameBox = (await frame.boundingBox())!;
  await ada.page.mouse.click(frameBox.x + frameBox.width * 0.5, frameBox.y + frameBox.height * 0.3);
  await expect(ada.page.getByTestId("pin")).toBeVisible();
  await ada.page.getByRole("button", { name: "Submit Pin" }).click();
  const linusFrame = imageOf(linus.page);
  await linusFrame.focus();
  await linusFrame.press("Enter"); // pin in the middle of the image
  for (let i = 0; i < 5; i++) await linusFrame.press("ArrowDown");
  await linusFrame.press("Enter");
  await expect(linus.page.getByTestId("pin")).toBeVisible();
  await linus.page.getByRole("button", { name: "Submit Pin" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Answer locked in!")).toBeVisible();
  });
  await expect(stage.getByText("2 pins")).toBeVisible();
  await expect(stage.getByTestId("correct-area")).toHaveCount(0);
  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await expect(stage.getByTestId("correct-area")).toBeVisible();
  await expect(stage.getByText("1 of 2 in the correct area (50%)")).toBeVisible();
  await expect(ada.page.getByText("Correct!")).toBeVisible({ timeout: REVEAL_TIMEOUT });
  await expect(ada.page.getByText("+300", { exact: true })).toBeVisible();
  await expect(linus.page.getByText("Not quite…")).toBeVisible({ timeout: REVEAL_TIMEOUT });

  // --- End: Ada led with 800 points ---
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await expect(ada.page.getByText(/You finished\s*#1/)).toBeVisible();
});

test("the builder edits and saves guess, 100 points, 2x2 grid and pin slides", async ({ host }) => {
  test.setTimeout(120_000);
  const deck = await host.createDeck(`E2E advanced builder ${Date.now()}`, [GUESS, POINTS, GRID, PIN]);
  const page = await host.open(`/presentation/create?id=${deck._id}`);
  await stubImage(page);
  const rail = page.getByRole("button", { name: /^Slide \d+ of \d+:/ });
  await expect(rail).toHaveCount(4);

  // guess_number: change the correct number and the tolerance.
  await expect(page.getByRole("switch", { name: "Graded" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Correct number")).toHaveValue("79");
  await page.getByLabel("Correct number").fill("42");
  await page.getByLabel("Tolerance (±)").fill("5");

  // hundred_points: add an item.
  await rail.nth(1).click();
  await expect(page.getByLabel("Items to share the points over: item 3")).toHaveValue("Speed");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Items to share the points over: item 4").fill("Support");

  // grid_2x2: rename an axis.
  await rail.nth(2).click();
  await expect(page.getByLabel("Name").first()).toHaveValue("Effort");
  await page.getByLabel("Name").first().fill("Cost");

  // pin_on_image: move the correct area with the number fields.
  await rail.nth(3).click();
  await expect(page.getByLabel("Alt text")).toHaveValue("Map of France");
  await expect(page.getByLabel("Left (%)")).toHaveValue("40");
  await page.getByLabel("Left (%)").fill("10");
  await page.getByLabel("Width (%)").fill("30");

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Presentation deck updated!")).toBeVisible();

  const saved = await host.getDeck(deck._id);
  expect(saved.slides[0]).toMatchObject({
    type: "guess_number",
    points: 500,
    config: { min: 0, max: 100, step: 1, correct: 42, tolerance: 5 },
  });
  expect(saved.slides[1]).toMatchObject({ config: { items: ["Docs", "Tests", "Speed", "Support"] } });
  expect(saved.slides[2]).toMatchObject({
    config: { x: { label: "Cost", min: 0, max: 10 }, y: { label: "Impact", min: 0, max: 10 } },
  });
  expect(saved.slides[3]).toMatchObject({
    content: { url: IMAGE_URL, alt: "Map of France" },
    config: { region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 } },
  });
});

test("the slide picker adds an ungraded guess slide that saves with its defaults", async ({ host }) => {
  test.setTimeout(120_000);
  const page = await host.open("/presentation/create");
  await page.getByRole("button", { name: "New slide" }).click();
  await expect(page.getByText("Advanced slides")).toBeVisible();
  await page.getByRole("button", { name: "Guess the Number" }).click();
  // The new slide follows the untouched starter slide; drop that one.
  await page.getByRole("button", { name: "Delete slide 1" }).click();

  const title = `E2E guess builder ${Date.now()}`;
  await page.getByLabel("Deck title").fill(title);
  await page.getByPlaceholder("What statement or question would you like to present?").fill("How tall is Everest (m)?");
  await expect(page.getByRole("switch", { name: "Graded" })).toHaveAttribute("aria-checked", "false");
  await page.getByLabel("Max", { exact: true }).fill("10000");
  await page.getByLabel("Step", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Create deck", exact: true }).click();
  await expect(page).toHaveURL(/\/polls/);
});
