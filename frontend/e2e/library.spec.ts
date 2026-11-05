import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * The library as a creator uses it: find an item by title, narrow by type,
 * close a live poll and delete a deck, each through the app's own
 * confirmation dialog.
 */

const heading = { type: "heading", content: { title: "Library check", subtitle: "" } };

async function createPoll(token: string, title: string) {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/polls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      isPublished: true,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      questions: [{ text: "Pick a day", options: ["Monday", "Friday"] }],
    }),
  });
  expect(res.status).toBe(201);
}

test("search, filter by type, close a poll and delete a deck", async ({ host }) => {
  const stamp = Date.now();
  const deckTitle = `E2E library deck ${stamp}`;
  const pollTitle = `E2E library poll ${stamp}`;
  await host.createDeck(deckTitle, [heading]);
  await createPoll(host.accessToken, pollTitle);

  const page = await host.open("/polls");
  const search = page.getByRole("searchbox", { name: "Search by title" }).or(page.getByLabel("Search by title"));
  await search.fill(String(stamp));
  // The search is debounced: wait until it reached the URL (and the list reloaded) before acting on cards.
  await expect(page).toHaveURL(new RegExp(`q=${stamp}`));
  await expect(page.getByRole("tab", { name: /^All 2/ })).toBeVisible();
  await expect(page.getByText(deckTitle)).toBeVisible();
  await expect(page.getByText(pollTitle)).toBeVisible();

  await page.getByRole("tab", { name: /Presentations/ }).click();
  await expect(page).toHaveURL(/type=presentation/);
  await expect(page.getByText(deckTitle)).toBeVisible();
  await expect(page.getByText(pollTitle)).toHaveCount(0);

  await page.getByRole("tab", { name: /Polls/ }).click();
  await expect(page).toHaveURL(/type=poll/);
  await expect(page.getByText(pollTitle)).toBeVisible();
  await expect(page.getByText(deckTitle)).toHaveCount(0);

  // Close the live poll.
  await page.getByRole("button", { name: `More actions for ${pollTitle}` }).click();
  await page.getByRole("menuitem", { name: "Close poll" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close poll" }).click();
  await expect(page.getByText("Poll closed.")).toBeVisible();

  // Delete the deck.
  await page.getByRole("tab", { name: /Presentations/ }).click();
  await expect(page).toHaveURL(/type=presentation/);
  await expect(page.getByText(pollTitle)).toHaveCount(0);
  await page.getByRole("button", { name: `More actions for ${deckTitle}` }).click();
  await page.getByRole("menuitem", { name: /Delete deck/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete deck" }).click();
  await expect(page.getByText("Deck deleted.")).toBeVisible();
  await expect(page.getByText(deckTitle)).toHaveCount(0);

  // Gone after a reload too (the search is in the URL; wait for the reloaded list).
  await page.reload();
  await expect(page.getByLabel("Search by title")).toHaveValue(String(stamp));
  await expect(page.getByText(pollTitle)).toHaveCount(0);
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(page.getByText(pollTitle)).toBeVisible();
  await expect(page.getByText(deckTitle)).toHaveCount(0);
});
