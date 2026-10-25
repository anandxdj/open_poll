import { expect, joinAsParticipant, joinMidSession, openLobby, test, type Participant } from "./fixtures";

/**
 * Session-aware live UI (W1-A2): what the host console and the phones do now
 * that every presentation is a session — starting without a lobby, going back
 * and forward through stored results, closing and reopening an untimed slide,
 * presenting twice, and resuming after a reload on either side. Timers are
 * long and driven by hand (Reveal, Close voting), so nothing here races the
 * auto-reveal.
 */

const LONG = 120;

const planets = {
  type: "select_answer",
  question: "Which planet is known as the Red Planet?",
  timeLimit: LONG,
  options: [
    { text: "Mars", isCorrect: true },
    { text: "Venus", isCorrect: false },
  ],
};

const heading = { type: "heading", content: { title: "Halfway there", subtitle: "Take a breath" } };

// Only unscored types may be untimed (`timeLimit: 0`).
const untimedCloud = {
  type: "wordcloud",
  question: "One word for your week",
  timeLimit: 0,
  maxEntries: 3,
};

const forBoth = (players: Participant[], fn: (p: Participant) => Promise<void>) => Promise.all(players.map(fn));

const answer = async ({ page }: Participant, option: RegExp) => {
  await page.getByRole("button", { name: option }).click();
  await page.getByRole("button", { name: "Submit Answer" }).click();
};

const sendWord = async ({ page }: Participant, word: string) => {
  await page.getByPlaceholder("Word 1 of 3…").fill(word);
  await page.getByRole("button", { name: "Send Words" }).click();
};

test("back and forward show the stored phase and results of every visited slide", async ({
  browser,
  contexts,
  host,
}) => {
  const second = { ...planets, question: "Which planet has the most moons?" };
  const deck = await host.createDeck(`E2E revisit ${Date.now()}`, [planets, heading, second]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  const players = [ada, grace];
  await expect(stage.getByText("2 JOINED")).toBeVisible();
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();

  // --- Slide 1: answer, then reveal by hand ---
  await expect(stage.getByText("SLIDE 1 OF 3")).toBeVisible();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(stage.getByText("Time left")).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Prev Slide" })).toBeDisabled();
  await answer(ada, /Mars/);
  await answer(grace, /Venus/);
  await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);
  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(stage.getByText("Results revealed")).toBeVisible();
  await expect(stage.getByText("Time left")).toHaveCount(0);
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await expect(grace.page.getByText("Not quite…")).toBeVisible();

  // --- Slide 2: content — phones say "look at the screen" ---
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("SLIDE 2 OF 3")).toBeVisible();
  await expect(stage.getByRole("heading", { name: "Halfway there" })).toBeVisible();
  await expect(stage.getByText("Voting")).toHaveCount(0);
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Look at the screen")).toBeVisible();
    await expect(page.getByText("Slide 1 of 3")).toHaveCount(0);
  });

  // --- Back (button): slide 1 returns revealed, with the results it had ---
  await hostPage.getByRole("button", { name: "Prev Slide" }).click();
  await expect(stage.getByText("SLIDE 1 OF 3")).toBeVisible();
  await expect(stage.getByText("Results revealed")).toBeVisible();
  await expect(stage.getByText("50%")).toHaveCount(2);
  await expect(stage.getByText("Time left")).toHaveCount(0);
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await expect(grace.page.getByText("Not quite…")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);

  // --- Forward (arrow keys) to a slide not seen yet, which opens fresh ---
  await hostPage.keyboard.press("ArrowRight");
  await expect(stage.getByText("SLIDE 2 OF 3")).toBeVisible();
  await hostPage.keyboard.press("ArrowRight");
  await expect(stage.getByText("SLIDE 3 OF 3")).toBeVisible();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(stage.getByText("Time left")).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: second.question })).toBeVisible();
    await expect(page.getByText("Time left")).toBeVisible();
  });
  await expect(hostPage.getByRole("button", { name: "End Session" })).toBeVisible();

  // --- Leaving that slide unanswered closes it; coming back never reopens it ---
  await hostPage.keyboard.press("ArrowLeft");
  await expect(stage.getByText("SLIDE 2 OF 3")).toBeVisible();
  await hostPage.keyboard.press("ArrowRight");
  await expect(stage.getByText("SLIDE 3 OF 3")).toBeVisible();
  await expect(stage.getByText("Voting closed")).toBeVisible();
  await expect(stage.getByText("Time left")).toHaveCount(0);
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Voting is closed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  });

  // --- Reopen gives it a fresh timer and the form comes back ---
  await hostPage.getByRole("button", { name: "Reopen" }).click();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(stage.getByText("Time left")).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("button", { name: "Submit Answer" })).toBeVisible();
  });
});

test("an untimed slide stays open until the host closes voting, and can be reopened", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E untimed ${Date.now()}`, [untimedCloud]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  const players = [ada, grace];
  await expect(stage.getByText("2 JOINED")).toBeVisible();
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();

  // Open, with no timer anywhere.
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(stage.getByText("No time limit")).toBeVisible();
  await expect(stage.getByText("Time left")).toHaveCount(0);
  await forBoth(players, async ({ page }) => {
    await expect(page.getByRole("heading", { name: untimedCloud.question })).toBeVisible();
    await expect(page.getByText("Time left")).toHaveCount(0);
  });

  await sendWord(ada, "calm");
  await expect(ada.page.getByText("Response received!")).toBeVisible();
  await expect(stage.getByText("calm", { exact: true })).toBeVisible();
  await expect(stage).toContainText(/1\s*\/\s*2\s*answered/);

  // Close voting: Grace, who has not answered, is locked out.
  await hostPage.getByRole("button", { name: "Close voting" }).click();
  await expect(stage.getByText("Voting closed")).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Close voting" })).toHaveCount(0);
  await expect(grace.page.getByText("Voting is closed")).toBeVisible();
  await expect(grace.page.getByRole("button", { name: "Send Words" })).toHaveCount(0);
  await expect(ada.page.getByText("Response received!")).toBeVisible();

  // Reopen: Grace can answer, Ada (who already did) cannot answer again.
  await hostPage.getByRole("button", { name: "Reopen" }).click();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(grace.page.getByRole("button", { name: "Send Words" })).toBeVisible();
  await expect(ada.page.getByText("Response received!")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Send Words" })).toHaveCount(0);
  await sendWord(grace, "busy");
  await expect(grace.page.getByText("Response received!")).toBeVisible();
  await expect(stage.getByText("busy", { exact: true })).toBeVisible();
  await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);

  // Close again, reveal, and reopen even after the reveal.
  await hostPage.getByRole("button", { name: "Close voting" }).click();
  await expect(stage.getByText("Voting closed")).toBeVisible();
  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(stage.getByText("Results revealed")).toBeVisible();
  await expect(stage.getByText("calm", { exact: true })).toBeVisible();
  await forBoth(players, async ({ page }) => {
    await expect(page.getByText("Waiting for host to advance…")).toBeVisible();
  });
  await hostPage.getByRole("button", { name: "Reopen" }).click();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(stage.getByText("No time limit")).toBeVisible();

  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();
});

test("presenting twice starts fresh and keeps the first session", async ({ browser, contexts, host }) => {
  const deck = await host.createDeck(`E2E twice ${Date.now()}`, [planets, heading]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");

  // --- Run 1: no lobby; Ada joins while the question is open ---
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(stage.getByText("SLIDE 1 OF 2")).toBeVisible();
  const ada = await joinMidSession(browser, contexts, deck.joinCode, "Ada");
  await expect(ada.page.getByRole("heading", { name: planets.question })).toBeVisible();
  await expect(ada.page.getByText("Time left")).toBeVisible();
  await expect(stage).toContainText(/0\s*\/\s*1\s*answered/);
  await answer(ada, /Mars/);
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();
  await expect(stage).toContainText(/1\s*\/\s*1\s*answered/);
  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(ada.page.getByText("Look at the screen")).toBeVisible();
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "That's a wrap!" })).toBeVisible();
  await expect(ada.page.getByText(/You finished\s*#1/)).toBeVisible();

  // --- Run 2: Present again starts from slide 1 with nobody and nothing ---
  await hostPage.getByRole("button", { name: "Present again" }).click();
  await expect(stage.getByText("SLIDE 1 OF 2")).toBeVisible();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(stage).toContainText(/0\s*\/\s*0\s*answered/);
  await expect(stage.getByText("50%")).toHaveCount(0);

  // The first run's phone is told a new session is live and can join it.
  await expect(ada.page.getByText("A new session is live")).toBeVisible();
  await ada.page.getByRole("button", { name: "Join the new session" }).click();
  await expect(ada.page.getByPlaceholder("Your nickname")).toHaveValue("Ada");
  await ada.page.getByRole("button", { name: "Join Session" }).click();
  await expect(ada.page.getByRole("heading", { name: planets.question })).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Submit Answer" })).toBeVisible();
  await expect(stage).toContainText(/0\s*\/\s*1\s*answered/);
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();

  // Both runs are on record, the first with what it collected.
  const sessions = await host.getSessions(deck._id);
  expect(sessions).toHaveLength(2);
  expect(sessions[0]).toMatchObject({ runNumber: 2, status: "ended", participantCount: 1, answerCount: 0 });
  expect(sessions[1]).toMatchObject({ runNumber: 1, status: "ended", participantCount: 1, answerCount: 1 });
});

test("reloading the phone or the host console mid-question resyncs from the server", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E reload ${Date.now()}`, [planets, heading]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(stage.getByText("SLIDE 1 OF 2")).toBeVisible();

  const ada = await joinMidSession(browser, contexts, deck.joinCode, "Ada");
  await expect(ada.page.getByRole("heading", { name: planets.question })).toBeVisible();

  // Credentials are stored per session.
  const [session] = await host.getSessions(deck._id);
  const key = `openpoll_participant_${deck.joinCode}_${session.sessionId}`;
  const stored = await ada.page.evaluate((k) => localStorage.getItem(k), key);
  expect(JSON.parse(stored ?? "null")).toMatchObject({ name: "Ada" });

  // Reload while the question is open: same person, same slide, still running.
  await ada.page.reload();
  await expect(ada.page.getByRole("heading", { name: planets.question })).toBeVisible();
  await expect(ada.page.getByText("Time left")).toBeVisible();
  await expect(ada.page.getByPlaceholder("Your nickname")).toHaveCount(0);
  await answer(ada, /Mars/);
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();

  // Reload after answering: still answered, no second try.
  await ada.page.reload();
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);

  // The host console resumes where it is: slide, phase, timer and answers.
  await hostPage.reload();
  await expect(stage.getByText("SLIDE 1 OF 2")).toBeVisible();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(stage.getByText("Time left")).toBeVisible();
  await expect(stage).toContainText(/1\s*\/\s*1\s*answered/);
  await expect(stage.getByRole("heading", { name: "Ready to present" })).toHaveCount(0);

  // Reveal, then reload the phone: the result is restored.
  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await ada.page.reload();
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await expect(ada.page.getByText("Waiting for host to advance…")).toBeVisible();

  // A content slide survives a reload too.
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(ada.page.getByText("Look at the screen")).toBeVisible();
  await ada.page.reload();
  await expect(ada.page.getByText("Look at the screen")).toBeVisible();

  // The host console also resumes a revealed or content slide after a reload.
  await hostPage.reload();
  await expect(stage.getByText("SLIDE 2 OF 2")).toBeVisible();
  await expect(stage.getByRole("heading", { name: "Halfway there" })).toBeVisible();
  await hostPage.getByRole("button", { name: "Prev Slide" }).click();
  await expect(stage.getByText("Results revealed")).toBeVisible();
  await hostPage.reload();
  await expect(stage.getByText("SLIDE 1 OF 2")).toBeVisible();
  await expect(stage.getByText("Results revealed")).toBeVisible();
  await expect(stage.getByText("100%")).toBeVisible();
});

test("a host who returns to a finished deck is offered Present again, not an auto-opened lobby", async ({
  host,
}) => {
  const deck = await host.createDeck(`E2E returning ${Date.now()}`, [heading]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await hostPage.getByRole("button", { name: "Start presenting" }).click();
  await expect(stage.getByText("SLIDE 1 OF 1")).toBeVisible();
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();

  // Opening the page again shows the finished run; nothing is wiped or opened.
  await hostPage.reload();
  await expect(stage.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Present again" })).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Open lobby" })).toBeVisible();
  const sessions = await host.getSessions(deck._id);
  expect(sessions).toHaveLength(1);
  expect(sessions[0].status).toBe("ended");
  expect(await host.lookupCodeStatus(deck.joinCode)).toBe(200);
});
