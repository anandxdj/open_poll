import { expect, test } from "./fixtures";

/**
 * W3-B2 co-editing safety: two builders open on the same deck. The first save
 * wins; the second is refused (409 DECK_CHANGED) and the builder says so
 * instead of overwriting, then either reloads the saved version or keeps its
 * own edits as a separate deck. Presence: a builder shows when the deck is open
 * elsewhere (the shared e2e host is the same user in both pages, so it is the
 * "another tab" note; other people show as avatars with the same socket path).
 */

const heading = (title: string) => ({ type: "heading", content: { title, subtitle: "" } });

const conflictAlert = (page: import("@playwright/test").Page) =>
  page.getByRole("alert").filter({ hasText: "Someone else saved this deck while you were editing" });

test("the second save of a deck someone else saved gets the conflict message, then reloads their version", async ({ host }) => {
  const title = `E2E co-edit ${Date.now()}`;
  const deck = await host.createDeck(title, [heading("Agenda")]);
  const first = await host.open(`/presentation/create?id=${deck._id}`);
  const second = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(first.getByLabel("Deck title")).toHaveValue(title);
  await expect(second.getByLabel("Deck title")).toHaveValue(title);

  // First editor saves.
  await first.getByLabel("Deck title").fill(`${title} by first`);
  await first.getByRole("button", { name: "Save changes" }).click();
  await expect(first).toHaveURL(/\/polls/);

  // Second editor, still on the old version, saves: refused, nothing overwritten.
  await second.getByLabel("Deck title").fill(`${title} by second`);
  await second.getByRole("button", { name: "Save changes" }).click();
  const alert = conflictAlert(second);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Your changes were not saved");
  await expect(second).toHaveURL(/\/presentation\/create\?id=/);
  expect((await host.getDeck(deck._id)).title).toBe(`${title} by first`);

  // Saving again while the conflict is open does not send anything.
  await second.getByRole("button", { name: "Save draft" }).click();
  await expect(second.getByText("Someone else saved this deck. Reload the latest version")).toBeVisible();
  expect((await host.getDeck(deck._id)).title).toBe(`${title} by first`);

  // Reload: their version, and saving works again on top of it.
  await alert.getByRole("button", { name: "Reload latest version" }).click();
  await expect(second.getByLabel("Deck title")).toHaveValue(`${title} by first`);
  await expect(conflictAlert(second)).toHaveCount(0);
  await second.getByLabel("Deck title").fill(`${title} after reload`);
  await second.getByRole("button", { name: "Save changes" }).click();
  await expect(second).toHaveURL(/\/polls/);
  expect((await host.getDeck(deck._id)).title).toBe(`${title} after reload`);
});

test("after a conflict an editor can keep their own version as a separate deck", async ({ host }) => {
  const title = `E2E co-edit copy ${Date.now()}`;
  const deck = await host.createDeck(title, [heading("One"), heading("Two")]);
  const first = await host.open(`/presentation/create?id=${deck._id}`);
  const second = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(second.getByLabel("Deck title")).toHaveValue(title);
  await expect(first.getByLabel("Deck title")).toHaveValue(title);

  await first.getByLabel("Deck title").fill(`${title} (theirs)`);
  await first.getByRole("button", { name: "Save changes" }).click();
  await expect(first).toHaveURL(/\/polls/);

  await second.getByRole("button", { name: "Delete slide 2" }).click();
  await second.getByRole("button", { name: "Save draft" }).click();
  const alert = conflictAlert(second);
  await expect(alert).toBeVisible();

  await alert.getByRole("button", { name: "Save mine as a copy" }).click();
  await expect(second.getByText("Your version is saved as a new deck.")).toBeVisible();
  await expect(second).not.toHaveURL(new RegExp(deck._id));
  await expect(second.getByLabel("Deck title")).toHaveValue(`${title} (my version)`);
  const copyId = new URL(second.url()).searchParams.get("id")!;
  const copy = await host.getDeck(copyId);
  expect(copy.slides).toHaveLength(1);
  // The other editor's save is untouched.
  const original = await host.getDeck(deck._id);
  expect(original.title).toBe(`${title} (theirs)`);
  expect(original.slides).toHaveLength(2);
});

test("the builder shows when the same deck is open in another tab, and stops when that tab closes", async ({ host, contexts }) => {
  const title = `E2E presence ${Date.now()}`;
  const deck = await host.createDeck(title, [heading("Hello")]);
  const first = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(first.getByLabel("Deck title")).toHaveValue(title);
  const elsewhere = (page: import("@playwright/test").Page) =>
    page.getByRole("status", { name: "You have this deck open in another tab" });
  await expect(elsewhere(first)).toHaveCount(0);

  const second = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(second.getByLabel("Deck title")).toHaveValue(title);
  await expect(elsewhere(second)).toBeVisible();
  await expect(elsewhere(first)).toBeVisible();

  // Closing the second builder tells the first at once (disconnect, then presence:update).
  const secondContext = contexts[contexts.length - 1]!;
  await secondContext.close();
  await expect(elsewhere(first)).toHaveCount(0);
});

test("a builder left open without edits picks up a co-editor's save on reload, with no conflict", async ({ host }) => {
  const title = `E2E untouched ${Date.now()}`;
  const deck = await host.createDeck(title, [heading("Agenda"), heading("Wrap-up")]);
  const idle = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(idle.getByLabel("Deck title")).toHaveValue(title);
  // Looking around is not editing: select the other slide.
  await idle.getByRole("button", { name: /^Slide 2 of 2:/ }).click();

  const editor = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(editor.getByLabel("Deck title")).toHaveValue(title);
  await editor.getByLabel("Deck title").fill(`${title} edited`);
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toHaveURL(/\/polls/);

  // The idle builder kept no local copy, so the reload shows the saved version.
  const draftKey = `openpoll_presentation_draft_${deck._id}`;
  expect(await idle.evaluate((key) => window.localStorage.getItem(key), draftKey)).toBeNull();
  await idle.reload();
  await expect(idle.getByLabel("Deck title")).toHaveValue(`${title} edited`);
  await expect(conflictAlert(idle)).toHaveCount(0);

  // Leaving without an edit saves nothing either (no revision bump that would make a co-editor stale).
  const revisionOf = async () => ((await host.getDeck(deck._id)) as unknown as { revision: number }).revision;
  const before = await revisionOf();
  await idle.getByRole("link", { name: "Back to the library" }).click();
  await expect(idle).toHaveURL(/\/polls/);
  await expect(idle.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  // The silent save on leaving would fire right after the unmount; give it time to (not) arrive.
  await idle.waitForTimeout(800);
  expect(await revisionOf()).toBe(before);
});
