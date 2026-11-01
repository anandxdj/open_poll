import type { Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * LIB-19: "Duplicate" in the library card menu. A two-slide deck and a poll
 * are copied from the menu; each copy appears in the list as a draft, the
 * deck copy opens (from the toast) in the builder with both slides, and the
 * originals are unchanged.
 */

const QUESTION = "Which planet is known as the Red Planet?";
const CLOUD = "One word for Mondays";
const NOTES = "Mars looks red because of the iron oxide on its surface.";

const slides = [
  {
    type: "select_answer",
    question: QUESTION,
    notes: NOTES,
    timeLimit: 30,
    options: [
      { text: "Mars", isCorrect: true },
      { text: "Venus", isCorrect: false },
    ],
  },
  { type: "wordcloud", question: CLOUD, timeLimit: 0 },
];

interface StoredPoll {
  _id: string;
  title: string;
  isPublished: boolean;
  questions: { _id: string; text: string; options: string[] }[];
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { data: T };
  return { status: res.status, data: body.data };
}

const railItems = (page: Page) => page.getByRole("button", { name: /^Slide \d+ of \d+:/ });
const card = (page: Page, title: string) =>
  page.getByRole("article").filter({ has: page.getByRole("link", { name: title, exact: true }) });

async function duplicateFromMenu(page: Page, title: string) {
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
}

test("LIB-19: duplicate a deck and a poll from the library menu", async ({ host }) => {
  const stamp = Date.now();
  const deckTitle = `E2E duplicate deck ${stamp}`;
  const pollTitle = `E2E duplicate poll ${stamp}`;
  const deck = await host.createDeck(deckTitle, slides);
  const created = await api<StoredPoll>(host.accessToken, "/polls", {
    method: "POST",
    body: JSON.stringify({
      title: pollTitle,
      isPublished: true,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      questions: [{ text: "Pick a day", options: ["Monday", "Friday"] }],
    }),
  });
  expect(created.status).toBe(201);
  const poll = created.data;
  const deckBefore = await host.getDeck(deck._id);

  const page = await host.open("/polls");
  await page.getByLabel("Search by title").fill(String(stamp));
  await expect(card(page, deckTitle)).toBeVisible();
  await expect(card(page, pollTitle)).toBeVisible();

  // --- The poll: a draft copy joins the list, the published original stays as it was ---
  await duplicateFromMenu(page, pollTitle);
  await expect(page.getByText("Poll duplicated.")).toBeVisible();
  const pollCopy = card(page, `Copy of ${pollTitle}`);
  await expect(pollCopy).toBeVisible();
  await expect(pollCopy.getByText("Draft", { exact: true })).toBeVisible();
  await expect(pollCopy.getByRole("link", { name: "Edit draft" })).toBeVisible();
  await expect(card(page, pollTitle).getByRole("button", { name: "Share" })).toBeVisible();

  // --- The deck: its copy joins the list too ---
  await duplicateFromMenu(page, deckTitle);
  await expect(page.getByText("Deck duplicated.")).toBeVisible();
  const deckCopy = card(page, `Copy of ${deckTitle}`);
  await expect(deckCopy).toBeVisible();
  await expect(deckCopy.getByText("2 slides")).toBeVisible();
  await expect(card(page, deckTitle)).toBeVisible();

  // Open the deck copy from its toast: the builder, both slides, the copy's own id.
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Deck duplicated." })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page).toHaveURL(/\/presentation\/create\?id=[a-f0-9]{24}/);
  const copyId = new URL(page.url()).searchParams.get("id")!;
  expect(copyId).not.toBe(deck._id);
  await expect(page.getByLabel("Deck title")).toHaveValue(`Copy of ${deckTitle}`);
  await expect(railItems(page)).toHaveCount(2);
  await expect(railItems(page).nth(0)).toHaveAccessibleName(new RegExp(QUESTION));
  await expect(railItems(page).nth(1)).toHaveAccessibleName(new RegExp(CLOUD));
  await expect(page.getByLabel("Speaker notes")).toHaveValue(NOTES);

  // The copy as stored: both slides under new ids, its own join code, a draft.
  const copy = await host.getDeck(copyId);
  expect(copy.joinCode).not.toBe(deck.joinCode);
  expect(copy.slides.map((slide) => slide.question)).toEqual([QUESTION, CLOUD]);
  expect(copy.slides.map((slide) => slide._id)).not.toContain(deckBefore.slides[0]!._id);

  // The originals are unchanged.
  expect(await host.getDeck(deck._id)).toEqual(deckBefore);
  expect(await host.getSessions(deck._id)).toEqual([]);
  const pollAfter = await api<StoredPoll>(host.accessToken, `/polls/${poll._id}`);
  expect(pollAfter.data).toEqual(poll);
});
