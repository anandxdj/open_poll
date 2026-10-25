import { expect, joinAsParticipant, openLobby, test, type Participant } from "./fixtures";

/**
 * Characterization of the live deck flow as users see it: the ready screen
 * (opening the host page opens nothing), an explicitly opened lobby, two
 * participants, a scored select-answer slide, a word cloud, a scales slide,
 * the timer-driven reveal, a leaderboard slide and the end screen. Assertions
 * use visible text and roles only, so the test survives a markup refactor.
 */

// Short timers keep the run fast; reveal fires on the host when they expire.
const TIME_LIMIT = 10;
const REVEAL_TIMEOUT = (TIME_LIMIT + 10) * 1000;

const slides = [
  {
    type: "select_answer",
    question: "Which planet is known as the Red Planet?",
    timeLimit: TIME_LIMIT,
    options: [
      { text: "Mars", isCorrect: true },
      { text: "Venus", isCorrect: false },
      { text: "Jupiter", isCorrect: false },
    ],
  },
  {
    type: "wordcloud",
    question: "One word for your favourite food",
    timeLimit: TIME_LIMIT,
    maxEntries: 3,
  },
  {
    type: "scales",
    question: "Rate this session",
    timeLimit: TIME_LIMIT,
    statements: ["The pace was right", "The examples helped"],
    scaleMax: 5,
    minLabel: "Disagree",
    maxLabel: "Agree",
  },
  { type: "leaderboard", question: "Standings" },
];

const forBoth = (players: Participant[], fn: (p: Participant) => Promise<void>) =>
  Promise.all(players.map(fn));

test("host runs a deck with two participants from lobby to the end screen", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E live flow ${Date.now()}`, slides);

  // --- Opening the host page opens nothing: no lobby, nobody can join yet ---
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await expect(hostPage.getByText("Host console")).toBeVisible();
  await expect(hostPage.getByRole("heading", { name: deck.title })).toBeVisible();
  await expect(stage.getByRole("heading", { name: "Ready to present" })).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Start presenting" })).toBeEnabled();
  await expect(stage.getByText(deck.joinCode, { exact: true })).toHaveCount(0);
  expect(await host.lookupCodeStatus(deck.joinCode)).toBe(404);

  // --- Lobby: opened explicitly ---
  await openLobby(hostPage, deck.joinCode);
  await expect(hostPage.getByText("Live session")).toBeVisible();
  await expect(stage.getByText("0 JOINED")).toBeVisible();
  await expect(stage.getByText("Waiting for players to enter code...")).toBeVisible();
  // Starting needs no audience.
  const startButton = hostPage.getByRole("button", { name: "Start", exact: true });
  await expect(startButton).toBeEnabled();

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  const players = [ada, grace];
  await forBoth(players, async ({ page, name }) => {
    await expect(page.getByText(deck.title)).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText("Waiting for the host to start the presentation.")).toBeVisible();
  });

  await expect(stage.getByText("2 JOINED")).toBeVisible();
  await expect(stage.getByText("Ada", { exact: true })).toBeVisible();
  await expect(stage.getByText("Grace", { exact: true })).toBeVisible();

  // --- Slide 1: select_answer (scored) ---
  await startButton.click();
  await expect(stage.getByText("SLIDE 1 OF 4")).toBeVisible();
  await expect(stage.getByRole("heading", { name: slides[0].question })).toBeVisible();
  await expect(stage.getByText("Time left")).toBeVisible();

  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Slide 1 of 4")).toBeVisible();
    await expect(page.getByRole("heading", { name: slides[0].question })).toBeVisible();
    await expect(page.getByText("Time left")).toBeVisible();
  });
  await ada.page.getByRole("button", { name: /Mars/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await grace.page.getByRole("button", { name: /Venus/ }).click();
  await grace.page.getByRole("button", { name: "Submit Answer" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Answer locked in!")).toBeVisible();
    await expect(
      page.getByText("Waiting for the reveal — faster answers earn more points.")
    ).toBeVisible();
  });

  // Host sees the live tally before the reveal.
  await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);
  await expect(stage.getByText("50%")).toHaveCount(2);

  // Timer runs out → host auto-reveals → participants get their result.
  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await expect(ada.page.getByText("Correct!")).toBeVisible({ timeout: REVEAL_TIMEOUT });
  await expect(ada.page.getByText(/^\+\d[\d,]*$/)).toBeVisible();
  await expect(ada.page.getByText("#1", { exact: true })).toBeVisible();
  await expect(grace.page.getByText("Not quite…")).toBeVisible({ timeout: REVEAL_TIMEOUT });
  await expect(grace.page.getByText("No points this round.")).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Waiting for host to advance…")).toBeVisible();
  });

  // --- Slide 2: wordcloud ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 2 OF 4")).toBeVisible();
  await expect(stage.getByRole("heading", { name: slides[1].question })).toBeVisible();

  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: slides[1].question })).toBeVisible();
    await expect(page.getByText("Add up to 3 words")).toBeVisible();
  });
  await ada.page.getByPlaceholder("Word 1 of 3…").fill("pizza");
  await ada.page.getByRole("button", { name: "Add" }).click();
  await ada.page.getByPlaceholder("Word 2 of 3…").fill("tacos");
  await ada.page.getByRole("button", { name: "Add" }).click();
  await ada.page.getByRole("button", { name: "Send Words" }).click();
  // The pending draft is sent along without pressing Add.
  await grace.page.getByPlaceholder("Word 1 of 3…").fill("pizza");
  await grace.page.getByRole("button", { name: "Send Words" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Response received!")).toBeVisible();
    await expect(page.getByText("Waiting for question to close.")).toBeVisible();
  });

  await expect(stage.getByText("pizza", { exact: true })).toBeVisible();
  await expect(stage.getByText("tacos", { exact: true })).toBeVisible();
  await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);

  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Waiting for host to advance…")).toBeVisible({
      timeout: REVEAL_TIMEOUT,
    });
    await expect(page.getByText("Response received!")).toBeVisible();
  });

  // --- Slide 3: scales ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 3 OF 4")).toBeVisible();
  await expect(stage.getByRole("heading", { name: slides[2].question })).toBeVisible();

  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("The pace was right")).toBeVisible();
    await expect(page.getByText("The examples helped")).toBeVisible();
    await expect(page.getByText("Disagree")).toHaveCount(2);
    await expect(page.getByRole("slider")).toHaveCount(2);
  });
  // Sliders start mid-scale (3 of 5); Ada moves the first one to 5.
  await ada.page.getByRole("slider").first().fill("5");
  await ada.page.getByRole("button", { name: "Submit Ratings" }).click();
  await grace.page.getByRole("button", { name: "Submit Ratings" }).click();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Response received!")).toBeVisible();
  });

  await expect(stage.getByText("The pace was right")).toBeVisible();
  await expect(stage).toContainText("4.0 / 5");
  await expect(stage).toContainText("3.0 / 5");

  await expect(stage.getByText("Time left")).toBeHidden({ timeout: REVEAL_TIMEOUT });
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Waiting for host to advance…")).toBeVisible({
      timeout: REVEAL_TIMEOUT,
    });
  });

  // --- Slide 4: leaderboard (last slide) ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 4 OF 4")).toBeVisible();
  await expect(stage.getByText("Ada", { exact: true })).toBeVisible();
  await expect(stage.getByText("Grace", { exact: true })).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Leaderboard", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("You", { exact: true })).toBeVisible();
    await expect(page.getByText("Ada", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Grace", { exact: true }).first()).toBeVisible();
  });

  // --- End ---
  await expect(hostPage.getByRole("button", { name: "Next Slide" })).toHaveCount(0);
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await expect(stage.getByText("Final standings")).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Present again" })).toBeVisible();

  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: "That's a wrap!" })).toBeVisible();
    await expect(page.getByText("Final standings")).toBeVisible();
  });
  await expect(ada.page.getByText(/You finished\s*#1/)).toBeVisible();
});
