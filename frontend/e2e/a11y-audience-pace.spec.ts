import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations as scan } from "./axe";
import { expect, test } from "./fixtures";

/**
 * W4-A accessibility, audience pace: axe scans of the host's audience dashboard
 * (host console and presenter view), the room screen's own-pace stage (audience
 * window) and the participant's own run (waiting, a question, answered with
 * right or wrong and results, the summary, the result after submitting, review)
 * in a light and a dark deck. Zero serious or critical findings.
 */

const PHONE = { viewport: { width: 390, height: 844 } };

const answer = async (page: Page, option: string) => {
  await page.getByRole("button", { name: new RegExp(option) }).click();
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText(/Answer (locked in|saved)/)).toBeVisible();
};

for (const mode of ["light", "dark"] as const) {
  test(`audience pace: dashboard, room screen and the phone's own run (${mode})`, async ({ browser, contexts, host }) => {
    test.setTimeout(300_000);
    const deck = await host.createDeck(
      `E2E a11y own pace ${mode} ${Date.now()}`,
      [
        {
          type: "select_answer",
          question: "Which colour are fire exit signs?",
          timeLimit: 30,
          points: 1000,
          explanation: "Exit signs are green so they read in smoke.",
          options: [
            { text: "Green", isCorrect: true },
            { text: "Purple", isCorrect: false },
          ],
        },
        { type: "heading", content: { title: "Safety first", subtitle: "Two questions" } },
        {
          type: "select_answer",
          question: "Which day is the alarm tested?",
          timeLimit: 30,
          points: 1000,
          options: [
            { text: "Monday", isCorrect: false },
            { text: "Friday", isCorrect: true },
          ],
        },
      ],
      {
        pace: "audience",
        theme: { mode },
        settings: {
          audiencePaced: {
            resultsVisibility: "after_submit",
            assessment: { enabled: true, maxAttempts: 1, passingScorePercentage: 60 },
          },
        },
      }
    );

    const hostPage = await host.open(`/presentation/host/${deck._id}`);
    const dashboard = hostPage.getByTestId("audience-dashboard");
    await expect(dashboard.getByText("Not open yet")).toBeVisible();
    await scan(hostPage, `audience dashboard · not open · ${mode}`);
    await dashboard.getByRole("button", { name: "Open lobby first" }).click();
    await expect(hostPage.getByTestId("audience-join-code")).toHaveText(deck.joinCode);
    await scan(hostPage, `audience dashboard · lobby · ${mode}`);

    const presenter = await host.open(`/presentation/${deck._id}/presenter`);
    await expect(presenter.getByTestId("audience-dashboard")).toBeVisible();
    const [screen] = await Promise.all([
      presenter.waitForEvent("popup"),
      presenter.getByRole("button", { name: "Open audience window" }).click(),
    ]);
    await screen.waitForLoadState();

    const context = await browser.newContext(PHONE);
    contexts.push(context);
    const ada = await context.newPage();
    await ada.goto(`/live/${deck.joinCode}`);
    await ada.getByPlaceholder("Your nickname").fill("Ada");
    await ada.getByRole("button", { name: "Join Session" }).click();
    await expect(ada.getByText("Then you go through them at your own pace.")).toBeVisible();
    await scan(ada, `participant own pace · waiting · ${mode}`);

    await dashboard.getByRole("button", { name: "Open to participants" }).click();
    await expect(dashboard.getByText("Open", { exact: true })).toBeVisible();
    await expect(ada.getByRole("heading", { name: "Which colour are fire exit signs?" })).toBeVisible();
    await scan(ada, `participant own pace · question · ${mode}`);
    await answer(ada, "Green");
    await scan(ada, `participant own pace · answered · ${mode}`);
    await expect(dashboard.getByTestId("audience-participant-row").filter({ hasText: "Ada" })).toContainText("1/2");
    await scan(hostPage, `audience dashboard · open with progress · ${mode}`);
    await expect(presenter.getByTestId("audience-participant-row").filter({ hasText: "Ada" })).toBeVisible();
    await scan(presenter, `presenter view · audience dashboard · ${mode}`);
    await expect(screen.getByTestId("stage-audience")).toBeVisible();
    await scan(screen, `audience window · own pace stage · ${mode}`);

    await ada.getByRole("button", { name: "Next", exact: true }).click();
    await expect(ada.getByText("Safety first")).toBeVisible();
    await scan(ada, `participant own pace · content slide · ${mode}`);
    await ada.getByRole("button", { name: "Next", exact: true }).click();
    await answer(ada, "Monday");
    await ada.getByRole("button", { name: "Finish" }).click();
    await expect(ada.getByRole("heading", { name: "Ready to submit?" })).toBeVisible();
    await scan(ada, `participant own pace · summary · ${mode}`);
    await ada.getByRole("button", { name: "Submit answers" }).click();
    await expect(ada.getByText("Not passed")).toBeVisible();
    await scan(ada, `participant own pace · result · ${mode}`);
    await ada.getByRole("button", { name: "Review answers" }).click();
    await expect(ada.getByRole("region", { name: "Results" }).first()).toBeVisible();
    await scan(ada, `participant own pace · review (right, results) · ${mode}`);

    await dashboard.getByRole("button", { name: "Close now" }).click();
    await expect(hostPage.getByRole("alertdialog")).toBeVisible();
    await scan(hostPage, `audience dashboard · close dialog · ${mode}`);
    await hostPage.getByRole("alertdialog").getByRole("button", { name: "Close now" }).click();
    await expect(dashboard.getByText("Closed", { exact: true })).toBeVisible();
    await scan(hostPage, `audience dashboard · closed · ${mode}`);
    await expect(ada.getByText("Closed", { exact: true }).first()).toBeVisible();
    await scan(ada, `participant own pace · closed · ${mode}`);
    await scan(screen, `audience window · own pace closed · ${mode}`);

    await dashboard.getByRole("button", { name: "End session" }).click();
    await hostPage.getByRole("alertdialog").getByRole("button", { name: "End session" }).click();
    await expect(dashboard.getByText("Ended", { exact: true })).toBeVisible();
    await scan(hostPage, `audience dashboard · ended · ${mode}`);
  });
}
