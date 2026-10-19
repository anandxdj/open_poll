import { expect, joinAsParticipant, openLobby, test, type Participant } from "./fixtures";

/**
 * select_answer beyond single choice: a graded multi-select slide (correct =
 * exactly the correct set, explanation after the reveal) and an ungraded
 * 0-point slide (a converted poll: results only, no right or wrong), live and
 * in the builder.
 */

const TIME_LIMIT = 10;
const REVEAL_TIMEOUT = (TIME_LIMIT + 10) * 1000;
const EXPLANATION = "The Moon orbits Earth; it is not a planet.";

const multiSelect = {
  type: "select_answer",
  question: "Which of these are planets?",
  timeLimit: TIME_LIMIT,
  points: 1000,
  options: [
    { text: "Mars", isCorrect: true },
    { text: "Moon", isCorrect: false },
    { text: "Earth", isCorrect: true },
  ],
  config: { allowMultiple: true, explanation: EXPLANATION },
};

const ungraded = {
  type: "select_answer",
  question: "Which season do you like best?",
  timeLimit: TIME_LIMIT,
  points: 0,
  scoreDependsOnTime: false,
  options: [
    { text: "Summer", isCorrect: false },
    { text: "Winter", isCorrect: false },
  ],
};

const forBoth = (players: Participant[], fn: (p: Participant) => Promise<void>) =>
  Promise.all(players.map(fn));

test("multi-select and ungraded select-answer slides run live", async ({ browser, contexts, host }) => {
  const deck = await host.createDeck(`E2E select answer ${Date.now()}`, [multiSelect, ungraded]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  const players = [ada, grace];
  await expect(stage.getByText("2 JOINED")).toBeVisible();

  // --- Slide 1: graded multi-select ---
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByRole("heading", { name: multiSelect.question })).toBeVisible();
  await expect(stage.getByText("Multiple answers allowed")).toBeVisible();

  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Select all that apply")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Submit Answer" })).toBeDisabled();
  });
  // Ada picks exactly the correct set; Grace misses Earth.
  await ada.page.getByRole("checkbox", { name: /Mars/ }).click();
  await ada.page.getByRole("checkbox", { name: /Moon/ }).click();
  await ada.page.getByRole("checkbox", { name: /Moon/ }).click();
  await ada.page.getByRole("checkbox", { name: /Earth/ }).click();
  await expect(ada.page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await grace.page.getByRole("checkbox", { name: /Mars/ }).click();
  await grace.page.getByRole("button", { name: "Submit Answer" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Answer locked in!")).toBeVisible();
  });

  // Shares are of respondents: Mars 2/2, Earth 1/2, Moon 0/2.
  await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);
  await expect(stage.getByText("100%")).toBeVisible();
  await expect(stage.getByText("50%")).toBeVisible();
  await expect(stage.getByText(EXPLANATION)).toHaveCount(0);

  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await expect(stage.getByText(EXPLANATION)).toBeVisible();
  await expect(ada.page.getByText("Correct!")).toBeVisible({ timeout: REVEAL_TIMEOUT });
  await expect(grace.page.getByText("Not quite…")).toBeVisible({ timeout: REVEAL_TIMEOUT });

  // --- Slide 2: ungraded single-select ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByRole("heading", { name: ungraded.question })).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: ungraded.question })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
  await ada.page.getByRole("button", { name: /Summer/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await grace.page.getByRole("button", { name: /Winter/ }).click();
  await grace.page.getByRole("button", { name: "Submit Answer" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Response received!")).toBeVisible();
    await expect(page.getByText("Waiting for question to close.")).toBeVisible();
  });
  await expect(stage.getByText("50%")).toHaveCount(2);

  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Waiting for host to advance…")).toBeVisible({ timeout: REVEAL_TIMEOUT });
    await expect(page.getByText("Response received!")).toBeVisible();
    await expect(page.getByText("Not quite…")).toHaveCount(0);
  });
  await expect(stage.getByText("50%")).toHaveCount(2);
  await expect(stage.getByText("Explanation")).toHaveCount(0);
});

test("the builder edits and saves an ungraded multi-select slide", async ({ host }) => {
  const converted = { ...ungraded, config: { allowMultiple: true, explanation: "Imported from a poll" } };
  const deck = await host.createDeck(`E2E converted poll ${Date.now()}`, [converted]);
  const page = await host.open(`/presentation/create?id=${deck._id}`);

  await expect(page.getByRole("switch", { name: "Graded" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: "Allow multiple answers" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(page.getByRole("button", { name: /Mark option \d correct/ })).toHaveCount(0);
  const explanation = page.getByLabel("Explanation (optional)");
  await expect(explanation).toHaveValue("Imported from a poll");

  await explanation.fill("Most people pick summer.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Presentation deck updated!")).toBeVisible();

  const saved = await host.getDeck(deck._id);
  expect(saved.slides[0]).toMatchObject({
    points: 0,
    options: [
      { text: "Summer", isCorrect: false },
      { text: "Winter", isCorrect: false },
    ],
    config: { allowMultiple: true, explanation: "Most people pick summer." },
  });
});
