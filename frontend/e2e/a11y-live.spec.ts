import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expectNoSeriousA11yViolations as scan, IMAGE_URL, stubMedia } from "./axe";
import { expect, test, type Host } from "./fixtures";

/**
 * W4-A accessibility, presenter pace: axe scans of every live surface through a
 * real session, in a light and in a dark deck. The host console (ready, lobby,
 * slide, reveal, end), the presenter view, the audience window it opens, the
 * phone remote it pairs, and the phones (join form, lobby, each slide type
 * family while answering, locked in, right and wrong results, leaderboard,
 * end, their results page). Zero serious or critical findings is the bar.
 */

const PHONE = { viewport: { width: 390, height: 844 } };

const QUIZ = {
  type: "select_answer",
  question: "What is the capital of France?",
  notes: "Ask who has been to Paris.",
  timeLimit: 120,
  points: 1000,
  options: [
    { text: "Paris", isCorrect: true },
    { text: "Lyon", isCorrect: false },
  ],
};

/** Opens `/live/<code>` on a phone-sized context; the caller joins. */
async function openPhone(browser: Browser, contexts: BrowserContext[], joinCode: string) {
  const context = await browser.newContext(PHONE);
  contexts.push(context);
  const page = await context.newPage();
  await stubMedia(page);
  await page.goto(`/live/${joinCode}`);
  await expect(page.getByPlaceholder("Your nickname")).toBeVisible();
  return page;
}

async function join(page: Page, name: string) {
  await page.getByPlaceholder("Your nickname").fill(name);
  await page.getByRole("button", { name: "Join Session" }).click();
  await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible();
}

async function openHost(host: Host, path: string) {
  const page = await host.open(path);
  await stubMedia(page);
  return page;
}

for (const mode of ["light", "dark"] as const) {
  test.describe(`${mode} deck`, () => {
    test(`core flow on every live surface (${mode})`, async ({ browser, contexts, host }) => {
      test.setTimeout(300_000);
      const deck = await host.createDeck(
        `E2E a11y core ${mode} ${Date.now()}`,
        [QUIZ, { type: "heading", content: { title: "Halfway there", subtitle: "Take a breath" } }, { type: "leaderboard", question: "Standings" }],
        { theme: { mode } }
      );

      // --- Ready: the host console, the presenter view, the audience window, the phone remote ---
      const hostPage = await openHost(host, `/presentation/host/${deck._id}`);
      const stage = hostPage.locator("main");
      await expect(hostPage.getByRole("button", { name: "Open lobby" })).toBeVisible();
      await scan(hostPage, `host console · ready · ${mode}`);

      const presenter = await openHost(host, `/presentation/${deck._id}/presenter`);
      await expect(presenter.locator("main").getByText("Ready to present")).toBeVisible();
      await scan(presenter, `presenter view · ready · ${mode}`);

      const [audience] = await Promise.all([
        presenter.waitForEvent("popup"),
        presenter.getByRole("button", { name: "Open audience window" }).click(),
      ]);
      await audience.waitForLoadState();
      await expect(audience.locator("main").getByText("Ready to present")).toBeVisible();
      await scan(audience, `audience window · ready · ${mode}`);

      await presenter.getByRole("button", { name: "Pair a phone" }).click();
      const link = (await presenter.getByTestId("remote-link").innerText()).trim();
      await scan(presenter, `presenter view · remote pairing · ${mode}`);
      const remoteContext = await browser.newContext(PHONE);
      contexts.push(remoteContext);
      const remote = await remoteContext.newPage();
      await remote.goto(link);
      await expect(remote.getByTestId("remote-link-status")).toHaveText("Connected");
      await scan(remote, `phone remote · not started · ${mode}`);

      // --- Lobby ---
      await hostPage.getByRole("button", { name: "Open lobby" }).click();
      await expect(stage.getByText(deck.joinCode, { exact: true })).toBeVisible();
      await scan(hostPage, `host console · lobby · ${mode}`);

      const ada = await openPhone(browser, contexts, deck.joinCode);
      await scan(ada, `participant · join form · ${mode}`);
      await join(ada, "Ada");
      await scan(ada, `participant · lobby · ${mode}`);
      const bob = await openPhone(browser, contexts, deck.joinCode);
      await join(bob, "Bob");
      await expect(presenter.getByTestId("participant-count")).toHaveText("2 joined");
      await scan(presenter, `presenter view · lobby · ${mode}`);
      await expect(audience.locator("main").getByText("2 joined")).toBeVisible();
      await scan(audience, `audience window · lobby · ${mode}`);
      await expect(remote.getByText(/Lobby open, 2 joined/)).toBeVisible();
      await scan(remote, `phone remote · lobby · ${mode}`);

      // --- A quiz slide, open ---
      await hostPage.getByRole("button", { name: "Start", exact: true }).click();
      await expect(stage.getByRole("heading", { name: QUIZ.question })).toBeVisible();
      await scan(hostPage, `host console · slide open · ${mode}`);
      await expect(ada.getByRole("heading", { name: QUIZ.question })).toBeVisible();
      await scan(ada, `participant · answering (select answer) · ${mode}`);
      await expect(presenter.getByTestId("speaker-notes")).toHaveText(QUIZ.notes);
      await scan(presenter, `presenter view · slide open · ${mode}`);
      await expect(audience.locator("main").getByRole("heading", { name: QUIZ.question })).toBeVisible();
      await scan(audience, `audience window · slide open · ${mode}`);
      await expect(remote.getByTestId("remote-phase")).toHaveText("Voting open");
      await scan(remote, `phone remote · slide open · ${mode}`);

      await ada.getByRole("button", { name: /Paris/ }).click();
      await ada.getByRole("button", { name: "Submit Answer" }).click();
      await expect(ada.getByText("Answer locked in!")).toBeVisible();
      await scan(ada, `participant · answer locked in · ${mode}`);
      await bob.getByRole("button", { name: /Lyon/ }).click();
      await bob.getByRole("button", { name: "Submit Answer" }).click();
      await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);

      // --- Reveal ---
      await hostPage.getByRole("button", { name: "Reveal" }).click();
      await expect(ada.getByText("Correct!")).toBeVisible();
      await scan(hostPage, `host console · reveal · ${mode}`);
      await scan(ada, `participant · result correct · ${mode}`);
      await expect(bob.getByText("Not quite…")).toBeVisible();
      await scan(bob, `participant · result wrong · ${mode}`);
      await expect(audience.locator("main").getByText("Results revealed")).toBeVisible();
      await scan(presenter, `presenter view · reveal · ${mode}`);
      await scan(audience, `audience window · reveal · ${mode}`);
      await expect(remote.getByTestId("remote-phase")).toHaveText("Results revealed");
      await scan(remote, `phone remote · reveal · ${mode}`);

      // --- A content slide and the leaderboard ---
      await hostPage.getByRole("button", { name: "Next Slide" }).click();
      await expect(stage.getByRole("heading", { name: "Halfway there" })).toBeVisible();
      await scan(hostPage, `host console · content slide · ${mode}`);
      await expect(ada.getByText(/look at the screen/i).first()).toBeVisible();
      await scan(ada, `participant · look at the screen · ${mode}`);

      await hostPage.getByRole("button", { name: "Next Slide" }).click();
      await expect(stage.getByText("Ada", { exact: true }).first()).toBeVisible();
      await scan(hostPage, `host console · leaderboard · ${mode}`);
      await expect(ada.getByText("Ada").first()).toBeVisible();
      await scan(ada, `participant · leaderboard · ${mode}`);

      // --- End: the app's dialog, then every end screen ---
      await hostPage.getByRole("button", { name: "End Session" }).click();
      await expect(hostPage.getByRole("alertdialog")).toBeVisible();
      await scan(hostPage, `host console · end session dialog · ${mode}`);
      await hostPage.getByRole("alertdialog").getByRole("button", { name: "End session" }).click();
      await expect(hostPage.getByRole("button", { name: "Present again" })).toBeVisible();
      await scan(hostPage, `host console · end · ${mode}`);
      await expect(ada.getByText("That's a wrap!")).toBeVisible();
      await scan(ada, `participant · end · ${mode}`);
      await expect(audience.locator("main").getByText("Session ended")).toBeVisible();
      await scan(presenter, `presenter view · end · ${mode}`);
      await scan(audience, `audience window · end · ${mode}`);
      await scan(remote, `phone remote · end · ${mode}`);

      await ada.goto(`/live/${deck.joinCode}/summary`);
      await expect(ada.getByRole("heading").first()).toBeVisible();
      await scan(ada, `participant · my results page · ${mode}`);
    });

    test(`every slide type family on the phone and the stage (${mode})`, async ({ browser, contexts, host }) => {
      test.setTimeout(420_000);
      const slides = [
        { type: "wordcloud", question: "One word for this week", timeLimit: 0, maxEntries: 3 },
        { type: "scales", question: "Rate this session", timeLimit: 0, statements: ["The pace was right", "The examples helped"], scaleMax: 5, minLabel: "Disagree", maxLabel: "Agree" },
        { type: "open_ended", question: "What should we change?", timeLimit: 0 },
        { type: "ranking", question: "Rank the features", timeLimit: 0, items: ["Speed", "Docs", "Themes"] },
        { type: "type_answer", question: "Which planet is closest to the sun?", timeLimit: 120, points: 500, acceptedAnswers: ["Mercury"] },
        {
          type: "select_answer",
          question: "Which are primary colours?",
          timeLimit: 120,
          points: 500,
          config: { allowMultiple: true, explanation: "Red, yellow and blue are the painter's primaries." },
          options: [
            { text: "Red", isCorrect: true },
            { text: "Green", isCorrect: false },
            { text: "Blue", isCorrect: true },
          ],
        },
        { type: "guess_number", question: "How many moons does Jupiter have?", timeLimit: 120, points: 500, scoreDependsOnTime: false, config: { min: 0, max: 100, step: 1, correct: 79, tolerance: 3 } },
        { type: "hundred_points", question: "Where should we invest?", timeLimit: 0, config: { items: ["Docs", "Tests", "Speed"] } },
        { type: "grid_2x2", question: "Place the ideas", timeLimit: 0, config: { items: ["Dark mode", "Offline"], x: { label: "Effort", min: 0, max: 10 }, y: { label: "Impact", min: 0, max: 10 } } },
        { type: "pin_on_image", question: "Where is Paris?", timeLimit: 120, points: 300, scoreDependsOnTime: false, content: { url: IMAGE_URL, alt: "Map of France" }, config: { region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } } },
        { type: "qna", question: "Ask us anything" },
        { type: "paragraph", content: { title: "Why we are here", body: "We **ship** every week. Read [the plan](https://example.com/plan)." } },
        { type: "bullets", content: { title: "Agenda", items: ["Wins", "Roadmap", "Q&A"] } },
        { type: "image", content: { url: IMAGE_URL, alt: "The team on stage", fit: "contain", caption: "Berlin, 2026" } },
        { type: "big_number", content: { value: 87.5, label: "of teams ship weekly", prefix: "", suffix: "%" } },
        { type: "quote", content: { text: "The best way to predict the future is to invent it.", attribution: "Alan Kay" } },
        { type: "video", content: { provider: "youtube", id: "dQw4w9WgXcQ", start: 30 } },
        { type: "instructions", content: { showQr: true, showCode: true, text: "Grab your phone for the quiz" } },
      ];
      const deck = await host.createDeck(`E2E a11y slides ${mode} ${Date.now()}`, slides, {
        theme: { mode },
        settings: { qna: { enabled: true, moderation: false } },
      });
      const hostPage = await openHost(host, `/presentation/host/${deck._id}`);
      const stage = hostPage.locator("main");
      await hostPage.getByRole("button", { name: "Open lobby" }).click();
      await expect(stage.getByText(deck.joinCode, { exact: true })).toBeVisible();
      const ada = await openPhone(browser, contexts, deck.joinCode);
      await join(ada, "Ada");
      await hostPage.getByRole("button", { name: "Start", exact: true }).click();

      /** Answers the slide on screen with the simplest input its form takes. */
      const answers: Record<string, (() => Promise<void>) | undefined> = {
        wordcloud: async () => {
          await ada.getByPlaceholder("Word 1 of 3…").fill("plants");
          await ada.getByRole("button", { name: "Send Words" }).click();
        },
        scales: () => ada.getByRole("button", { name: "Submit Ratings" }).click(),
        open_ended: async () => {
          await ada.getByPlaceholder("Share your thoughts or answer freely…").fill("More breaks");
          await ada.getByRole("button", { name: "Submit Feedback" }).click();
        },
        ranking: () => ada.getByRole("button", { name: "Submit Ranking" }).click(),
        type_answer: async () => {
          await ada.getByPlaceholder("Type your exact answer here…").fill("Mercury");
          await ada.getByRole("button", { name: "Submit Answer" }).click();
        },
        select_answer: async () => {
          await ada.getByRole("checkbox", { name: /Red/ }).click();
          await ada.getByRole("button", { name: "Submit Answer" }).click();
        },
        guess_number: () => ada.getByRole("button", { name: "Submit Guess" }).click(),
        hundred_points: async () => {
          await ada.getByRole("spinbutton", { name: "Points for Docs" }).fill("100");
          await ada.getByRole("button", { name: "Submit Points" }).click();
        },
      };

      for (const [index, slide] of slides.entries()) {
        const label = `${slide.type} (${index + 1}/${slides.length})`;
        if (index > 0) await hostPage.getByRole("button", { name: "Next Slide" }).click();
        await expect(stage.getByText(`Slide ${index + 1} of ${slides.length}`, { exact: false })).toBeVisible();
        const response = "question" in slide && slide.type !== "qna";
        if (response) await expect(ada.getByRole("heading", { name: slide.question as string })).toBeVisible();
        else await expect(ada.locator("main")).not.toBeEmpty();
        await scan(hostPage, `host console · ${label} · ${mode}`);
        await scan(ada, `participant · ${label} · ${mode}`);
        if (!response) continue;

        const answer = answers[slide.type];
        if (answer) {
          await answer();
          await expect(ada.getByText(/Answer locked in!|Response received!/)).toBeVisible();
          await scan(ada, `participant · ${label} answered · ${mode}`);
        }
        await hostPage.getByRole("button", { name: "Reveal" }).click();
        await expect(stage.getByText("Results revealed")).toBeVisible();
        await scan(hostPage, `host console · ${label} revealed · ${mode}`);
        await scan(ada, `participant · ${label} revealed · ${mode}`);
      }
    });
  });
}
