import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, joinAsParticipant, test, type Host } from "./fixtures";

/**
 * W2-F audience pace, end to end with real clicks: a poll converted to a deck
 * runs with every question open at once, each participant moving on their own.
 *
 * 1. A converted TRIAL (assessment): the builder's Pace tab sets 2 attempts and
 *    results after each answer; the host opens a lobby, then the questions; Ada
 *    races through and passes while Bob is still on the first question (the
 *    dashboard shows both), Bob fails, retries and passes; the host closes the
 *    questions through the app's dialog and the phones say so.
 * 2. A converted poll with results after submit and optional nicknames: a guest
 *    answers one question and sees its results at once, the other none; the
 *    dashboard's progress per question; close and end.
 */

type ApiOk<T> = { success: boolean; data: T };

const api = async <T>(host: Host, path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.accessToken}`, ...init.headers },
  });
  const body = (await res.json()) as ApiOk<T>;
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  return body.data;
};

/** Creates a published poll (POLL or TRIAL) and converts it to a deck, as "Convert to presentation" does. */
const convertedDeck = async (host: Host, poll: Record<string, unknown>) => {
  const created = await api<{ _id: string }>(host, "/polls", {
    method: "POST",
    body: JSON.stringify({ isPublished: true, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...poll }),
  });
  const { presentation } = await api<{ presentation: { _id: string; joinCode: string; pace: string } }>(
    host,
    `/library/convert/poll/${created._id}`,
    { method: "POST" }
  );
  expect(presentation.pace).toBe("audience");
  return presentation;
};

/** Answers the question on screen: pick the option, send it, wait until it is saved. */
const answer = async (page: Page, option: string) => {
  await page.getByRole("button", { name: new RegExp(option) }).click();
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText(/Answer (locked in|saved)/)).toBeVisible();
};

const dashboardRow = (hostPage: Page, name: string) =>
  hostPage.getByTestId("audience-participant-row").filter({ hasText: name });

/** Nicknames optional: joins without one (a guest), or with the one given. */
async function joinOptional(browser: Browser, contexts: BrowserContext[], joinCode: string, name?: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/live/${joinCode}`);
  await expect(page.getByText("Add a nickname, or join as a guest.")).toBeVisible();
  if (name) await page.getByPlaceholder("Nickname (optional)").fill(name);
  await page.getByRole("button", { name: "Join Session" }).click();
  return page;
}

test("a converted assessment in audience pace: two speeds, a pass, a fail and a retry, the dashboard and close", async ({
  browser,
  contexts,
  host,
}) => {
  test.setTimeout(120_000);
  const deck = await convertedDeck(host, {
    title: `E2E assessment ${Date.now()}`,
    pollType: "TRIAL",
    passingScorePercentage: 60,
    questions: [
      { text: "Which colour are fire exit signs?", options: ["Green", "Purple"], type: "single", correctOptionIndices: [0], explanation: "Exit signs are green so they read in smoke." },
      { text: "Which day is the alarm tested?", options: ["Monday", "Friday"], type: "single", correctOptionIndices: [1] },
    ],
  });

  // --- Builder: the Pace tab (real clicks; each change saves on its own) ---
  const builder = await host.open(`/presentation/create?id=${deck._id}`);
  await builder.getByRole("tab", { name: "Pace" }).click();
  await expect(builder.getByRole("radio", { name: /Audience pace/ })).toHaveAttribute("aria-checked", "true");
  await expect(builder.getByLabel("Grade it as an assessment")).toBeChecked();
  await expect(builder.getByLabel("Pass mark (%)")).toHaveValue("60");
  // A converted TRIAL allows unlimited attempts; make it two.
  await builder.getByLabel("Unlimited attempts").uncheck();
  await expect(builder.getByLabel("Attempts", { exact: true })).toHaveValue("3");
  await builder.getByLabel("Attempts", { exact: true }).fill("2");
  await builder.getByLabel("Attempts", { exact: true }).press("Enter");
  await builder.getByRole("radio", { name: "After each answer" }).click();
  await expect(builder.getByRole("status").filter({ hasText: "Changes save as you make them" })).toBeVisible();
  await expect
    .poll(async () => ((await host.getDeck(deck._id)) as unknown as { settings: Record<string, unknown> }).settings.audiencePaced)
    .toMatchObject({ resultsVisibility: "after_submit", assessment: { enabled: true, maxAttempts: 2, passingScorePercentage: 60 } });

  // --- Host: the dashboard instead of the stage ---
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const dashboard = hostPage.getByTestId("audience-dashboard");
  await expect(dashboard.getByText("Not open yet")).toBeVisible();
  await dashboard.getByRole("button", { name: "Open lobby first" }).click();
  await expect(hostPage.getByTestId("audience-join-code")).toHaveText(deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const bob = await joinAsParticipant(browser, contexts, deck.joinCode, "Bob");
  await expect(ada.page.getByText("Then you go through them at your own pace.")).toBeVisible();
  await expect(dashboardRow(hostPage, "Bob")).toBeVisible();

  await dashboard.getByRole("button", { name: "Open to participants" }).click();
  await expect(dashboard.getByText("Open", { exact: true })).toBeVisible();
  for (const { page } of [ada, bob]) {
    await expect(page.getByRole("heading", { name: "Which colour are fire exit signs?" })).toBeVisible();
    await expect(page.getByText("0 of 2 answered")).toBeVisible();
  }

  // --- Ada is fast: both questions, then submits (Bob has not touched the first yet) ---
  await answer(ada.page, "Green");
  // Graded, not final: no right/wrong and no results yet, even with results after each answer.
  await expect(ada.page.getByText("Correct answers appear once your result is final.")).toBeVisible();
  await expect(dashboardRow(hostPage, "Ada")).toContainText("1/2");
  await expect(dashboardRow(hostPage, "Bob")).toContainText("0/2");
  await expect(dashboardRow(hostPage, "Bob")).toContainText("Not started");
  await ada.page.getByRole("button", { name: "Next", exact: true }).click();
  await answer(ada.page, "Friday");
  await expect(ada.page.getByText("2 of 2 answered")).toBeVisible();
  await ada.page.getByRole("button", { name: "Finish" }).click();
  await expect(ada.page.getByRole("heading", { name: "Ready to submit?" })).toBeVisible();
  await ada.page.getByRole("button", { name: "Submit answers" }).click();
  await expect(ada.page.getByText("100%", { exact: true })).toBeVisible();
  await expect(ada.page.getByText("Passed", { exact: true })).toBeVisible();
  await expect(ada.page.getByText("Pass mark 60%")).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(dashboardRow(hostPage, "Ada")).toContainText("Passed · 100%");
  await expect(hostPage.getByTestId("audience-stat-finished")).toHaveText("1 of 2");
  // Final: reviewing shows right/wrong, the explanation and the results.
  await ada.page.getByRole("button", { name: "Review answers" }).click();
  await expect(ada.page.getByText("Correct", { exact: true })).toBeVisible();
  await expect(ada.page.getByText("Exit signs are green so they read in smoke.")).toBeVisible();
  await expect(ada.page.getByRole("region", { name: "Results" })).toBeVisible();

  // --- Bob is slower and gets the second one wrong: 50 % < 60 % ---
  await answer(bob.page, "Green");
  await bob.page.getByRole("button", { name: "Next", exact: true }).click();
  await answer(bob.page, "Monday");
  await bob.page.getByRole("button", { name: "Finish" }).click();
  await bob.page.getByRole("button", { name: "Submit answers" }).click();
  await expect(bob.page.getByText("50%", { exact: true })).toBeVisible();
  await expect(bob.page.getByText("Not passed")).toBeVisible();
  await expect(bob.page.getByText("1 attempt left")).toBeVisible();
  await expect(dashboardRow(hostPage, "Bob")).toContainText("Not passed · 50%");
  await expect(hostPage.getByTestId("audience-stat-failed")).toHaveText("1");

  // --- Bob tries again: a fresh attempt, every question again, then passes ---
  await bob.page.getByRole("button", { name: "Try again" }).click();
  await expect(bob.page.getByText("Attempt 2", { exact: true })).toBeVisible();
  await expect(bob.page.getByText("0 of 2 answered")).toBeVisible();
  await expect(dashboardRow(hostPage, "Bob")).toContainText("In progress");
  await answer(bob.page, "Green");
  await bob.page.getByRole("button", { name: "Next", exact: true }).click();
  await answer(bob.page, "Friday");
  await bob.page.getByRole("button", { name: "Finish" }).click();
  await bob.page.getByRole("button", { name: "Submit answers" }).click();
  await expect(bob.page.getByText("100%", { exact: true })).toBeVisible();
  await expect(bob.page.getByText("Passed", { exact: true })).toBeVisible();
  await expect(bob.page.getByText("Attempt 1: 50%")).toBeVisible();
  await expect(dashboardRow(hostPage, "Bob")).toContainText("Passed · 100%");
  await expect(hostPage.getByTestId("audience-stat-passed")).toHaveText("2");
  await expect(hostPage.getByTestId("audience-stat-finished")).toHaveText("2 of 2");

  // --- Close now, through the app's dialog ---
  await dashboard.getByRole("button", { name: "Close now" }).click();
  const dialog = hostPage.getByRole("alertdialog");
  await expect(dialog.getByText("Close the questions now?")).toBeVisible();
  await dialog.getByRole("button", { name: "Close now" }).click();
  await expect(dashboard.getByText("Closed", { exact: true })).toBeVisible();
  await expect(ada.page.getByText("Closed", { exact: true })).toBeVisible();

  const [run] = await host.getSessions(deck._id);
  expect(run).toMatchObject({ status: "active", isLive: true, participantCount: 2 });
});

test("a converted poll with results after submit: a guest sees results per answered question, the host closes and ends", async ({
  browser,
  contexts,
  host,
}) => {
  test.setTimeout(90_000);
  const deck = await convertedDeck(host, {
    title: `E2E poll ${Date.now()}`,
    pollType: "POLL",
    questions: [
      { text: "Pizza or salad?", options: ["Pizza", "Salad"], type: "single" },
      { text: "Which day suits you?", options: ["Tuesday", "Thursday"], type: "single" },
    ],
  });

  // Builder: results after each answer, nicknames optional.
  const builder = await host.open(`/presentation/create?id=${deck._id}`);
  await builder.getByRole("tab", { name: "Pace" }).click();
  await builder.getByRole("radio", { name: "After each answer" }).click();
  await builder.getByRole("radio", { name: /^Optional/ }).click();
  await expect
    .poll(async () => ((await host.getDeck(deck._id)) as unknown as { settings: Record<string, unknown> }).settings)
    .toMatchObject({ nickname: "optional", audiencePaced: { resultsVisibility: "after_submit" } });

  // A room screen (W4-D embed) on the deck: allowed, with a screen link.
  await api(host, `/presentations/${deck._id}`, { method: "PATCH", body: JSON.stringify({ settings: { embed: { allowed: true } } }) });
  const { token: screenToken } = await api<{ token: string }>(host, "/embeds/screen-tokens", {
    method: "POST",
    body: JSON.stringify({ presentationId: deck._id, label: "Hall" }),
  });

  // Host opens the questions straight away (no lobby).
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const dashboard = hostPage.getByTestId("audience-dashboard");
  await dashboard.getByRole("button", { name: "Open to participants" }).click();
  await expect(dashboard.getByText("Open until you close it")).toBeVisible();

  // The screen shows how to join and the room's progress, never anyone's answers.
  const screenContext = await browser.newContext();
  contexts.push(screenContext);
  const screen = await screenContext.newPage();
  await screen.goto(`/embed/stage/${deck._id}?token=${screenToken}`);
  const screenStage = screen.getByTestId("stage-audience");
  await expect(screenStage.getByRole("heading", { name: "Answer at your own pace" })).toBeVisible();
  await expect(screenStage.getByText(deck.joinCode)).toBeVisible();

  // A guest (no nickname) and a named participant join while it runs.
  const guest = await joinOptional(browser, contexts, deck.joinCode);
  await expect(guest.locator("header").getByText(/^Guest \d{4}$/)).toBeVisible();
  const linus = await joinOptional(browser, contexts, deck.joinCode, "Linus");
  await expect(linus.getByRole("heading", { name: "Pizza or salad?" })).toBeVisible();

  // The guest answers the first question: results at once (an ungraded poll question: no right or wrong).
  await answer(guest, "Pizza");
  await expect(guest.getByText("Answer saved")).toBeVisible();
  await expect(guest.getByText("Your answer: Pizza")).toBeVisible();
  const results = guest.getByRole("region", { name: "Results" });
  await expect(results).toBeVisible();
  await expect(results.getByText("1 response")).toBeVisible();
  await expect(guest.getByText("Correct", { exact: true })).toHaveCount(0);
  // The second question, not answered yet, shows no results.
  await guest.getByRole("button", { name: "Next", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Which day suits you?" })).toBeVisible();
  await expect(guest.getByRole("region", { name: "Results" })).toHaveCount(0);
  // Back keeps what was answered.
  await guest.getByRole("button", { name: "Back", exact: true }).click();
  await expect(guest.getByText("Your answer: Pizza")).toBeVisible();

  // Dashboard: progress per question and who is in.
  const progress = hostPage.getByTestId("audience-slide-progress");
  await expect(progress.nth(0)).toContainText("1 of 2 answered");
  await expect(progress.nth(1)).toContainText("0 of 2 answered");
  await expect(hostPage.getByTestId("audience-stat-participants")).toHaveText("2");
  await expect(hostPage.getByTestId("audience-stat-started")).toHaveText("1");
  await expect(screen.getByTestId("stage-audience-participants")).toHaveText("2 participants");
  await expect(screenStage.getByText("1 of 2 answered")).toBeVisible();
  // No results, no names, no picks on the projected screen.
  await expect(screenStage.getByText("Pizza", { exact: true })).toHaveCount(0);
  await expect(screenStage.getByText(/Guest \d{4}|Linus/)).toHaveCount(0);

  // Linus answers on another phone; the guest's results count him too after a re-read.
  await answer(linus, "Salad");
  await expect(progress.nth(0)).toContainText("2 of 2 answered");

  // Close now: answers stop; the unanswered question says so.
  await dashboard.getByRole("button", { name: "Close now" }).click();
  await hostPage.getByRole("alertdialog").getByRole("button", { name: "Close now" }).click();
  await expect(dashboard.getByText("Closed", { exact: true })).toBeVisible();
  await guest.getByRole("button", { name: "Next", exact: true }).click();
  await expect(guest.getByText("Closed before you answered")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  await expect(screen.getByRole("heading", { name: "Answers are closed" })).toBeVisible();

  // End session through the app's dialog: the run is on record.
  await dashboard.getByRole("button", { name: "End session" }).click();
  await hostPage.getByRole("alertdialog").getByRole("button", { name: "End session" }).click();
  await expect(dashboard.getByText("Ended", { exact: true })).toBeVisible();
  const [run] = await host.getSessions(deck._id);
  expect(run).toMatchObject({ status: "ended", participantCount: 2, answerCount: 2 });
});
