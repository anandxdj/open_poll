import type { Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * The deck builder as a creator uses it: a deck built by hand from Home and
 * presented (BLD-39), the local draft that keeps edits across a reload and the
 * silent backend draft when leaving (BLD-38), and the validation that keeps a
 * scored slide without a correct option from being presented (BLD-07).
 */

const QUESTION = "Which planet is known as the Red Planet?";
const CLOUD = "One word for Mondays";
const NOTES = "Mars looks red because of the iron oxide on its surface.";

const planets = {
  type: "select_answer",
  question: QUESTION,
  timeLimit: 30,
  options: [
    { text: "Mars", isCorrect: true },
    { text: "Venus", isCorrect: false },
  ],
};

const railItems = (page: Page) => page.getByRole("button", { name: /^Slide \d+ of \d+:/ });

/** The builder's browser draft for a deck (`null` = the deck not saved yet). */
const readLocalDraft = (page: Page, deckId: string | null) =>
  page.evaluate(
    (key) => window.localStorage.getItem(key) ?? "",
    deckId ? `openpoll_presentation_draft_${deckId}` : "openpoll_presentation_draft_new"
  );

async function decksTitled(token: string, title: string) {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/presentations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { data: { _id: string; title: string }[] };
  return body.data.filter((deck) => deck.title === title);
}

async function addSlide(page: Page, label: string) {
  await page.getByRole("button", { name: "New slide" }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("BLD-39: a deck built by hand from Home saves and opens in the host console on Present", async ({ host }) => {
  const title = `E2E built by hand ${Date.now()}`;
  const page = await host.open("/home");

  // --- Home → New deck → Build manually ---
  await page.getByRole("button", { name: "New deck" }).click();
  const dialog = page.getByRole("dialog", { name: "New deck" });
  await dialog.getByLabel("Deck title").fill(title);
  await dialog.getByRole("button", { name: /Build manually/ }).click();
  await expect(page).toHaveURL(/\/presentation\/create\?.*mode=manual/);
  await expect(page.getByLabel("Deck title")).toHaveValue(title);
  await expect(railItems(page)).toHaveCount(1);

  // --- Slide 1: the starter multiple-choice slide, with Mars marked correct ---
  await page.getByLabel("Question or title").fill(QUESTION);
  await page.getByPlaceholder("Option 1", { exact: true }).fill("Venus");
  await page.getByPlaceholder("Option 2", { exact: true }).fill("Mars");
  await page.getByRole("button", { name: "Add option" }).click();
  await page.getByPlaceholder("Option 3", { exact: true }).fill("Jupiter");
  // A new slide marks its first option; move the mark to Mars.
  const markVenus = page.getByRole("button", { name: "Mark option 1 correct" });
  const markMars = page.getByRole("button", { name: "Mark option 2 correct" });
  await expect(markVenus).toHaveAttribute("aria-pressed", "true");
  await markVenus.click();
  await markMars.click();
  await expect(markVenus).toHaveAttribute("aria-pressed", "false");
  await expect(markMars).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Speaker notes").fill(NOTES);

  // --- Slide 2: word cloud, two words each ---
  await addSlide(page, "Word Cloud");
  await expect(railItems(page)).toHaveCount(2);
  await expect(page.getByText("Slide 2 of 2", { exact: true })).toBeVisible();
  await page.getByLabel("Question or title").fill(CLOUD);
  const entries = page.getByRole("group", { name: "Entries per participant" });
  await entries.getByRole("button", { name: "2", exact: true }).click();
  await expect(entries.getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-pressed", "true");

  // --- Slide 3: heading ---
  await addSlide(page, "Heading");
  await expect(railItems(page)).toHaveCount(3);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Thanks for playing");
  await page.getByRole("textbox", { name: "Subtitle", exact: true }).fill("See you next week");

  // The first slide kept its notes while the others were added.
  await railItems(page).first().click();
  await expect(page.getByLabel("Speaker notes")).toHaveValue(NOTES);

  // --- Present: offered once the deck exists, so save it as a draft first ---
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/[?&]id=[0-9a-f]{24}/);
  const deckId = new URL(page.url()).searchParams.get("id")!;
  await page.getByRole("button", { name: "Present", exact: true }).click();

  // --- The host console opens on this deck ---
  await expect(page).toHaveURL(new RegExp(`/presentation/host/${deckId}$`));
  await expect(page.getByText("Host console", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator("main").getByRole("heading", { name: "Ready to present" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start presenting" })).toBeEnabled();

  // Saved as built: three slides, the answer key and the notes; one deck, not two.
  const saved = await host.getDeck(deckId);
  expect(saved.title).toBe(title);
  expect(saved.slides).toHaveLength(3);
  expect(saved.slides[0]).toMatchObject({
    type: "select_answer",
    question: QUESTION,
    notes: NOTES,
    options: [
      { text: "Venus", isCorrect: false },
      { text: "Mars", isCorrect: true },
      { text: "Jupiter", isCorrect: false },
    ],
  });
  expect(saved.slides[1]).toMatchObject({ type: "wordcloud", question: CLOUD, maxEntries: 2 });
  expect(saved.slides[2]).toMatchObject({
    type: "heading",
    content: { title: "Thanks for playing", subtitle: "See you next week" },
  });
  expect(await decksTitled(host.accessToken, title)).toHaveLength(1);

  // The deck runs: slide 1 is the question that was typed.
  await page.getByRole("button", { name: "Start presenting" }).click();
  await expect(page.locator("main").getByText("SLIDE 1 OF 3")).toBeVisible();
  await expect(page.locator("main").getByRole("heading", { name: QUESTION })).toBeVisible();
});

test("BLD-38: a new deck's edits survive a reload before it is saved", async ({ host }) => {
  const title = `E2E unsaved new deck ${Date.now()}`;
  const page = await host.open("/presentation/create");
  await page.getByLabel("Deck title").fill(title);
  await page.getByLabel("Question or title").fill(QUESTION);
  await page.getByPlaceholder("Option 1", { exact: true }).fill("Mars");
  await addSlide(page, "Word Cloud");
  await page.getByLabel("Question or title").fill(CLOUD);

  // The browser draft catches up with the last keystroke, then the tab reloads.
  await expect.poll(() => readLocalDraft(page, null)).toContain(CLOUD);
  await page.reload();

  await expect(page.getByLabel("Deck title")).toHaveValue(title);
  await expect(railItems(page)).toHaveCount(2);
  // The slide that was open is open again.
  await expect(page.getByText("Slide 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Question or title")).toHaveValue(CLOUD);
  await railItems(page).first().click();
  await expect(page.getByLabel("Question or title")).toHaveValue(QUESTION);
  await expect(page.getByPlaceholder("Option 1", { exact: true })).toHaveValue("Mars");
});

test("BLD-38: edits to a saved deck survive a reload before they are saved", async ({ host }) => {
  const deck = await host.createDeck(`E2E unsaved edits ${Date.now()}`, [planets]);
  const page = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(page.getByLabel("Question or title")).toHaveValue(QUESTION);

  const edited = "Which planet has the tallest volcano?";
  await page.getByLabel("Question or title").fill(edited);
  await addSlide(page, "Word Cloud");
  await page.getByLabel("Question or title").fill(CLOUD);

  await expect.poll(() => readLocalDraft(page, deck._id)).toContain(CLOUD);
  await page.reload();

  await expect(railItems(page)).toHaveCount(2);
  await expect(page.getByLabel("Question or title")).toHaveValue(CLOUD);
  await railItems(page).first().click();
  await expect(page.getByLabel("Question or title")).toHaveValue(edited);
});

test("BLD-38: leaving the builder keeps an unsaved new deck as a backend draft", async ({ host }) => {
  const title = `E2E left unsaved ${Date.now()}`;
  const page = await host.open("/presentation/create");
  await page.getByLabel("Deck title").fill(title);
  await page.getByLabel("Question or title").fill(QUESTION);

  await page.getByRole("link", { name: "Back to the library" }).click();
  await expect(page).toHaveURL(/\/polls/);

  // Saved silently, once, with what was typed.
  await expect.poll(async () => (await decksTitled(host.accessToken, title)).length).toBe(1);
  const [draft] = await decksTitled(host.accessToken, title);
  const saved = await host.getDeck(draft._id);
  expect(saved.slides[0]).toMatchObject({ type: "select_answer", question: QUESTION });

  await page.reload();
  await page.getByLabel("Search by title").fill(title);
  await expect(page.getByText(title)).toBeVisible();
});

test("BLD-07: Present is refused while a scored slide has no correct option", async ({ host }) => {
  const deck = await host.createDeck(`E2E no answer key ${Date.now()}`, [planets]);
  const page = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(page.getByLabel("Question or title")).toHaveValue(QUESTION);

  // Unmark Mars: the scored slide has no correct option left.
  const markMars = page.getByRole("button", { name: "Mark option 1 correct" });
  await expect(markMars).toHaveAttribute("aria-pressed", "true");
  await markMars.click();
  await expect(markMars).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("Slide 1: mark a correct option.")).toBeVisible();
  await expect(page).toHaveURL(/\/presentation\/create\?id=/);
  // Nothing was saved: the stored deck still has its answer key.
  const stored = await host.getDeck(deck._id);
  expect(stored.slides[0]).toMatchObject({ options: [{ text: "Mars", isCorrect: true }, { text: "Venus" }] });

  // Mark it again and Present goes through.
  await markMars.click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/presentation/host/${deck._id}$`));
  await expect(page.locator("main").getByRole("heading", { name: "Ready to present" })).toBeVisible();
});
