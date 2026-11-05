import type { Locator, Page } from "@playwright/test";
import { expect, joinAsParticipant, openLobby, endSession, test, type Host } from "./fixtures";

/**
 * Light deck themes: a deck is light or dark, and a new deck takes the app
 * theme its creator uses. Every surface draws the deck's mode: the builder
 * canvas and rail thumbnails, the host console stage, the presenter view, the
 * phone. Colours are read with getComputedStyle (the Graph paper stage is
 * #f6f6f3 light, #141413 dark; phones #f6f6f3 / #0d0d0c). Screenshots of the
 * light builder, stage and phone land in test-results/deck-themes-*.png.
 */

const PAPER = "rgb(246, 246, 243)";
const GRAPHITE = "rgb(20, 20, 19)";
const PHONE_DARK = "rgb(13, 13, 12)";

const QUESTION = "Which colour should the new office be?";

/** The first non-transparent background at or above the element: the surface it sits on. */
const surfaceColor = (locator: Locator) =>
  locator.evaluate((element) => {
    let node: Element | null = element;
    while (node) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
      node = node.parentElement;
    }
    return "none";
  });

/** Sets the app theme the way the profile switch does (next-themes, localStorage `theme`) and reloads. */
async function useAppTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => window.localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

const canvas = (page: Page) => page.getByRole("figure").getByTestId("slide-thumbnail");
const railThumbs = (page: Page) => page.getByRole("button", { name: /^Slide \d+ of \d+:/ }).getByTestId("slide-thumbnail");

/** Builds a one-question deck in the builder and saves it as a draft; returns its id. */
async function buildDeck(page: Page, title: string) {
  await page.goto(`/presentation/create?name=${encodeURIComponent(title)}&mode=manual`);
  await expect(page.getByLabel("Deck title")).toHaveValue(title);
  await page.getByLabel("Question or title").fill(QUESTION);
  await page.getByPlaceholder("Option 1", { exact: true }).fill("Orange");
  await page.getByPlaceholder("Option 2", { exact: true }).fill("Blue");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/presentation\/create\?.*id=[a-f0-9]{24}/);
  return new URL(page.url()).searchParams.get("id")!;
}

async function storedMode(host: Host, id: string) {
  const deck = (await host.getDeck(id)) as unknown as { theme?: { mode?: string } };
  return deck.theme?.mode;
}

test("a deck made in the light app is light everywhere; the Theme tab switches it to dark everywhere", async ({
  host,
  browser,
  contexts,
}) => {
  const page = await host.open("/home");
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  const id = await buildDeck(page, `E2E light deck ${Date.now()}`);
  expect(await storedMode(host, id)).toBe("light");

  // Builder: the canvas and the rail thumbnail are paper, the question is ink.
  await expect.poll(() => surfaceColor(canvas(page))).toBe(PAPER);
  await expect.poll(() => surfaceColor(railThumbs(page).first())).toBe(PAPER);
  // (The canvas is aria-hidden, a picture of the slide: found by tag.)
  await expect(canvas(page).locator("h2", { hasText: QUESTION })).toHaveCSS("color", "rgb(23, 23, 23)");
  await page.screenshot({ path: "test-results/deck-themes-builder-light.png", fullPage: true });

  // Host console: the ready screen and the lobby on paper.
  const hostPage = await host.open(`/presentation/host/${id}`);
  const stage = hostPage.locator("main").first();
  await expect(hostPage.getByRole("button", { name: "Open lobby" })).toBeVisible();
  await expect.poll(() => surfaceColor(stage)).toBe(PAPER);
  const deck = await host.getDeck(id);
  await openLobby(hostPage, deck.joinCode);
  await expect.poll(() => surfaceColor(stage)).toBe(PAPER);

  // The phone of a participant follows the deck, not their device.
  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const phoneHeading = ada.page.getByRole("heading", { name: "You're in!" });
  await expect.poll(() => surfaceColor(phoneHeading)).toBe(PAPER);

  // Running slide: the question on the stage and the answer buttons on the phone stay light.
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(hostPage.locator("main").getByRole("heading", { name: QUESTION })).toBeVisible();
  await expect.poll(() => surfaceColor(hostPage.locator("main").getByRole("heading", { name: QUESTION }))).toBe(PAPER);
  await expect(ada.page.getByRole("button", { name: "Orange" })).toBeVisible();
  await expect.poll(() => surfaceColor(ada.page.getByRole("heading", { name: QUESTION }))).toBe(PAPER);
  await hostPage.screenshot({ path: "test-results/deck-themes-stage-light.png" });
  await ada.page.screenshot({ path: "test-results/deck-themes-phone-light.png", fullPage: true });

  // Presenter view of the live session: the light stage colours too.
  const presenter = await host.open(`/presentation/${id}/presenter`);
  await expect(presenter.getByText(QUESTION).first()).toBeVisible();
  await expect.poll(() => surfaceColor(presenter.getByText(QUESTION).first())).not.toBe("none");
  await expect.poll(() => surfaceColor(presenter.locator("header").first())).toBe("rgb(255, 255, 255)");
  await presenter.screenshot({ path: "test-results/deck-themes-presenter-light.png" });
  await presenter.close();

  await endSession(hostPage);
  await expect(hostPage.getByRole("button", { name: "Present again" })).toBeVisible();

  // Theme tab: Dark. The canvas and thumbnails turn graphite at once.
  await page.getByRole("tab", { name: "Theme" }).click();
  const modes = page.getByRole("radiogroup", { name: "Light or dark" });
  await expect(modes.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
  await modes.getByRole("radio", { name: "Dark" }).click();
  await expect(page.getByText("Theme saved")).toBeVisible();
  await expect(modes.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => surfaceColor(canvas(page))).toBe(GRAPHITE);
  await expect.poll(() => surfaceColor(railThumbs(page).first())).toBe(GRAPHITE);
  expect(await storedMode(host, id)).toBe("dark");
  // The builder around the canvas keeps the app's light theme.
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  await page.screenshot({ path: "test-results/deck-themes-builder-dark.png", fullPage: true });

  // The host console (ended session: the deck's current theme) and the next session are dark, phone included.
  await hostPage.reload();
  await expect(hostPage.getByRole("button", { name: "Present again" })).toBeVisible();
  await expect.poll(() => surfaceColor(hostPage.locator("main").first())).toBe(GRAPHITE);
  await hostPage.getByRole("button", { name: "Open lobby" }).click();
  await expect(hostPage.locator("main").getByText(deck.joinCode, { exact: true })).toBeVisible();
  await expect.poll(() => surfaceColor(hostPage.locator("main").first())).toBe(GRAPHITE);
  const ben = await joinAsParticipant(browser, contexts, deck.joinCode, "Ben");
  await expect.poll(() => surfaceColor(ben.page.getByRole("heading", { name: "You're in!" }))).toBe(PHONE_DARK);
  await hostPage.screenshot({ path: "test-results/deck-themes-stage-dark.png" });
  await ben.page.screenshot({ path: "test-results/deck-themes-phone-dark.png", fullPage: true });

  // While it runs, the Theme tab cannot restyle it (a running session keeps its look).
  await modes.getByRole("radio", { name: "Light" }).click();
  await expect(page.getByText(/live session/i).first()).toBeVisible();
  expect(await storedMode(host, id)).toBe("dark");
  await hostPage.reload();
  await expect(hostPage.locator("main").getByText(deck.joinCode, { exact: true })).toBeVisible();
  await expect.poll(() => surfaceColor(hostPage.locator("main").first())).toBe(GRAPHITE);
  await hostPage.getByRole("button", { name: "Close lobby" }).click();
  await hostPage.getByRole("alertdialog").getByRole("button", { name: "End session" }).click();
});

test("a deck made in the dark app is dark: canvas, thumbnails and the host stage", async ({ host }) => {
  const page = await host.open("/home");
  await useAppTheme(page, "dark");
  const id = await buildDeck(page, `E2E dark deck ${Date.now()}`);
  expect(await storedMode(host, id)).toBe("dark");
  await expect.poll(() => surfaceColor(canvas(page))).toBe(GRAPHITE);
  await expect.poll(() => surfaceColor(railThumbs(page).first())).toBe(GRAPHITE);

  // Switching the app back to light leaves the deck dark: the deck keeps its own mode.
  await useAppTheme(page, "light");
  await expect.poll(() => surfaceColor(canvas(page))).toBe(GRAPHITE);
  await page.getByRole("tab", { name: "Theme" }).click();
  await expect(page.getByRole("radiogroup", { name: "Light or dark" }).getByRole("radio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true"
  );

  const hostPage = await host.open(`/presentation/host/${id}`);
  await expect(hostPage.getByRole("button", { name: "Open lobby" })).toBeVisible();
  await expect.poll(() => surfaceColor(hostPage.locator("main").first())).toBe(GRAPHITE);
});

test("a light deck runs light on the stage and the phone: content, quiz reveal, word cloud, leaderboard, end", async ({
  host,
  browser,
  contexts,
}) => {
  const deck = await host.createDeck(`E2E light run ${Date.now()}`, [
    { type: "heading", content: { title: "Welcome to the light stage", subtitle: "Paper, ink and ember" } },
    {
      type: "select_answer",
      question: "Which planet is known as the Red Planet?",
      timeLimit: 120,
      points: 1000,
      options: [
        { text: "Mars", isCorrect: true },
        { text: "Venus", isCorrect: false },
      ],
    },
    { type: "wordcloud", question: "One word for this office", timeLimit: 0, maxEntries: 3 },
    { type: "leaderboard", question: "Standings" },
  ]);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main").first();
  await openLobby(hostPage, deck.joinCode);
  await hostPage.waitForTimeout(600);
  await hostPage.screenshot({ path: "test-results/deck-themes-lobby-light.png" });
  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");

  // Heading slide.
  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByText("Welcome to the light stage")).toBeVisible();
  await expect.poll(() => surfaceColor(stage.getByText("Welcome to the light stage"))).toBe(PAPER);
  await expect(stage.getByText("Welcome to the light stage")).toHaveCSS("color", "rgb(23, 23, 23)");
  await expect.poll(() => surfaceColor(ada.page.getByText(/look at the screen/i).first())).not.toBe(PHONE_DARK);

  // Quiz: answers, reveal; the correct option is marked in the light green.
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByRole("heading", { name: "Which planet is known as the Red Planet?" })).toBeVisible();
  await ada.page.getByRole("button", { name: /Mars/ }).click();
  await ada.page.getByRole("button", { name: "Submit Answer" }).click();
  await grace.page.getByRole("button", { name: /Venus/ }).click();
  await grace.page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(stage).toContainText(/2\s*\/\s*2\s*answered/);
  await hostPage.getByRole("button", { name: "Reveal" }).click();
  await expect(ada.page.getByText("Correct!")).toBeVisible();
  await expect(grace.page.getByText("Not quite…")).toBeVisible();
  await expect.poll(() => surfaceColor(ada.page.getByText("Correct!"))).not.toBe(PHONE_DARK);
  await hostPage.waitForTimeout(800);
  await hostPage.screenshot({ path: "test-results/deck-themes-reveal-light.png" });
  await ada.page.screenshot({ path: "test-results/deck-themes-phone-correct-light.png", fullPage: true });
  await grace.page.screenshot({ path: "test-results/deck-themes-phone-wrong-light.png", fullPage: true });

  // Word cloud: words in the dark chart steps on paper.
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByRole("heading", { name: "One word for this office" })).toBeVisible();
  for (const [who, word] of [
    [ada, "plants"],
    [grace, "light"],
  ] as const) {
    await who.page.getByPlaceholder("Word 1 of 3…").fill(word);
    await who.page.getByRole("button", { name: "Send Words" }).click();
  }
  await expect(stage.getByText("plants", { exact: true })).toBeVisible();
  await expect.poll(() => surfaceColor(stage.getByText("plants", { exact: true }))).toBe(PAPER);
  await hostPage.waitForTimeout(800);
  await hostPage.screenshot({ path: "test-results/deck-themes-wordcloud-light.png" });

  // Leaderboard and the end screen.
  await hostPage.getByRole("button", { name: "Close voting" }).click();
  await hostPage.getByRole("button", { name: "Next Slide" }).click();
  await expect(stage.getByText("Ada", { exact: true }).first()).toBeVisible();
  await expect.poll(() => surfaceColor(stage.getByText("Ada", { exact: true }).first())).not.toBe(GRAPHITE);
  await hostPage.waitForTimeout(800);
  await hostPage.screenshot({ path: "test-results/deck-themes-leaderboard-light.png" });
  await ada.page.screenshot({ path: "test-results/deck-themes-phone-leaderboard-light.png", fullPage: true });
  await endSession(hostPage);
  await expect(hostPage.getByRole("button", { name: "Present again" })).toBeVisible();
  await expect.poll(() => surfaceColor(stage)).toBe(PAPER);
  await hostPage.waitForTimeout(600);
  await hostPage.screenshot({ path: "test-results/deck-themes-end-light.png" });
  await ada.page.screenshot({ path: "test-results/deck-themes-phone-end-light.png", fullPage: true });
});

test("a deck made outside the builder without a mode is light, and a template used in the light app is light", async ({
  host,
}) => {
  // API (no mode, like MCP or a script): light.
  const apiDeck = await host.createDeck(`E2E API deck ${Date.now()}`, [
    { type: "heading", content: { title: "Hello from the API" } },
  ]);
  expect(await storedMode(host, apiDeck._id)).toBe("light");
  const hostPage = await host.open(`/presentation/host/${apiDeck._id}`);
  await expect(hostPage.getByRole("button", { name: "Open lobby" })).toBeVisible();
  await expect.poll(() => surfaceColor(hostPage.locator("main").first())).toBe(PAPER);

  // Use template in the light app: a light deck, its content and instruction slides on paper.
  const page = await host.open("/templates");
  await page.getByRole("region", { name: "Starter templates" }).getByRole("button", { name: "Use template Team retro" }).click();
  await expect(page).toHaveURL(/\/presentation\/create\?id=[a-f0-9]{24}/);
  const id = new URL(page.url()).searchParams.get("id")!;
  expect(await storedMode(host, id)).toBe("light");
  await expect.poll(() => surfaceColor(canvas(page))).toBe(PAPER);
  await expect(railThumbs(page)).toHaveCount(9);
  for (let i = 0; i < 9; i++) await expect.poll(() => surfaceColor(railThumbs(page).nth(i))).toBe(PAPER);
  await page.getByRole("button", { name: /^Slide 2 of 9:/ }).click();
  await page.screenshot({ path: "test-results/deck-themes-template-light.png", fullPage: true });

  // The same template in the dark app makes a dark deck.
  await useAppTheme(page, "dark");
  await page.goto("/templates");
  await page.getByRole("region", { name: "Starter templates" }).getByRole("button", { name: "Use template Team retro" }).click();
  await expect(page).not.toHaveURL(new RegExp(id));
  await expect(page).toHaveURL(/\/presentation\/create\?id=[a-f0-9]{24}/);
  const darkId = new URL(page.url()).searchParams.get("id")!;
  expect(await storedMode(host, darkId)).toBe("dark");
  await expect.poll(() => surfaceColor(canvas(page))).toBe(GRAPHITE);
});
