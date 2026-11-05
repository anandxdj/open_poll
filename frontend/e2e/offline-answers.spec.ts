import { endSession, expect, joinAsParticipant, openLobby, test, type Host } from "./fixtures";

/**
 * Offline answers (W2-D phase 2): a phone that loses the network keeps its
 * answer in the offline queue (IndexedDB) with "Saved — will sync", sends it
 * when the network is back — over the rejoined socket or REST, always with
 * the same `clientAnswerId` — and the host counts it exactly once. A queued
 * answer survives the page being closed, and an answer the server refuses
 * for good (voting closed meanwhile) says so. Timers are long and the host
 * acts by hand, so nothing races the auto-reveal.
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

const answered = (count: number, of: number) => new RegExp(`${count}\\s*/\\s*${of}\\s*answered`);

/** The deck's latest run once `end` has written its counts (they are 0 until then). */
const endedRun = (host: Host, deckId: string) =>
  expect.poll(async () => (await host.getSessions(deckId))[0], { timeout: 10_000 });

test("an answer given offline survives 10 s without network and counts exactly once", async ({ browser, contexts, host }) => {
  const deck = await host.createDeck(`E2E offline ${Date.now()}`, [planets]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  await expect(stage.getByText("2 JOINED")).toBeVisible();
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByText("Voting open")).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: planets.question })).toBeVisible();

  // Mid-answer: Ada picks Mars, then her phone loses the network before she submits.
  await ada.page.getByRole("button", { name: /Mars/ }).click();
  await ada.page.context().setOffline(true);
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ada.page.getByText("Saved — will sync")).toBeVisible();
  await expect(ada.page.getByText("Your answer is saved on this device.", { exact: false })).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);

  // Grace answers normally meanwhile; the host counts only her.
  await grace.page.getByRole("button", { name: /Venus/ }).click();
  await grace.page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(grace.page.getByText("Answer locked in!")).toBeVisible();
  await expect(stage).toContainText(answered(1, 2));

  // Ten seconds and more without network: still saved, still not counted.
  await ada.page.waitForTimeout(10_500);
  await expect(ada.page.getByText("Saved — will sync")).toBeVisible();
  await expect(stage).toContainText(answered(1, 2));

  // Back online: the queue sends it, the phone locks it in, the host counts it.
  await ada.page.context().setOffline(false);
  await expect(ada.page.getByText("Answer locked in!")).toBeVisible();
  await expect(ada.page.getByText("Saved — will sync")).toHaveCount(0);
  await expect(stage).toContainText(answered(2, 2));

  // Exactly once: whatever retries went out (socket, REST, the queue), the run has two answers.
  await ada.page.waitForTimeout(1_500);
  await expect(stage).toContainText(answered(2, 2));
  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(stage.getByText("Results revealed")).toBeVisible();
  await expect(stage.getByText("50%")).toHaveCount(2);
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await expect(grace.page.getByText("Not quite…")).toBeVisible();

  await endSession(hostPage);
  await expect(ada.page.getByRole("heading", { name: "That's a wrap!" })).toBeVisible();
  await endedRun(host, deck._id).toMatchObject({ status: "ended", participantCount: 2, answerCount: 2 });
});

test("a saved answer survives closing the page and is sent when the page opens again", async ({ browser, contexts, host }) => {
  const deck = await host.createDeck(`E2E offline reload ${Date.now()}`, [planets]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  await expect(stage.getByText("1 JOINED")).toBeVisible();
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(ada.page.getByRole("heading", { name: planets.question })).toBeVisible();

  const phone = ada.page.context();
  await phone.setOffline(true);
  await ada.page.getByRole("button", { name: /Mars/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ada.page.getByText("Saved — will sync")).toBeVisible();

  // The tab is closed while offline; the network comes back while no page is open.
  await ada.page.close();
  await phone.setOffline(false);
  await hostPage.waitForTimeout(1_500);
  await expect(stage).toContainText(answered(0, 1));

  // Opening the deck again on that phone finds the answer in IndexedDB and sends it.
  const page = await phone.newPage();
  await page.goto(`/live/${deck.joinCode}`);
  await expect(page.getByRole("heading", { name: planets.question })).toBeVisible();
  await expect(page.getByText("Answer locked in!")).toBeVisible();
  await expect(stage).toContainText(answered(1, 1));

  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(page.getByText("Correct!")).toBeVisible();
  await endSession(hostPage);
  await expect(page.getByRole("heading", { name: "That's a wrap!" })).toBeVisible();
  await endedRun(host, deck._id).toMatchObject({ status: "ended", participantCount: 1, answerCount: 1 });
});

test("a saved answer that reaches the server after voting closed is refused with a clear message", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await host.createDeck(`E2E offline refused ${Date.now()}`, [planets]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  await expect(stage.getByText("1 JOINED")).toBeVisible();
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(ada.page.getByRole("heading", { name: planets.question })).toBeVisible();

  await ada.page.context().setOffline(true);
  await ada.page.getByRole("button", { name: /Venus/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ada.page.getByText("Saved — will sync")).toBeVisible();

  // The host closes voting while the phone is offline.
  await hostPage.getByRole("button", { name: "Close voting" }).click();
  await expect(stage.getByText("Voting closed")).toBeVisible();

  await ada.page.context().setOffline(false);
  await expect(ada.page.getByText("Voting closed before your answer arrived")).toBeVisible();
  await expect(ada.page.getByText("It was not counted.")).toBeVisible();
  await expect(ada.page.getByText("Saved — will sync")).toHaveCount(0);
  await expect(ada.page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  await expect(stage).toContainText(answered(0, 1));

  await endSession(hostPage);
  await expect(ada.page.getByRole("heading", { name: "That's a wrap!" })).toBeVisible();
  await endedRun(host, deck._id).toMatchObject({ status: "ended", answerCount: 0 });
});
