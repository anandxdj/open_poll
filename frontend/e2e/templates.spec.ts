import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * W3-B2 templates: a starter template becomes a new draft deck that opens in
 * the builder with its slides, and a deck saved as a template from the
 * library is listed under "Saved in this workspace", used, then deleted.
 */

const railItems = (page: Page) => page.getByRole("button", { name: /^Slide \d+ of \d+:/ });

test("use a starter template: the builder opens with its slides", async ({ host }) => {
  const page = await host.open("/templates");
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  const starters = page.getByRole("region", { name: "Starter templates" });
  for (const name of ["Team retro", "Conference talk with Q&A", "Classroom quiz", "All-hands pulse"]) {
    await expect(starters.getByRole("heading", { name, level: 3 })).toBeVisible();
  }

  await starters.getByRole("button", { name: "Use template Team retro" }).click();
  await expect(page).toHaveURL(/\/presentation\/create\?id=[a-f0-9]{24}/);
  await expect(page.getByLabel("Deck title")).toHaveValue("Team retro");
  await expect(railItems(page)).toHaveCount(9);
  await expect(railItems(page).nth(2)).toHaveAccessibleName(/How did this sprint feel\?/);

  // It is an ordinary draft deck of the workspace.
  const id = new URL(page.url()).searchParams.get("id")!;
  const deck = await host.getDeck(id);
  expect(deck).toMatchObject({ title: "Team retro" });
  expect(deck.slides).toHaveLength(9);
});

test("save a deck as a template from the library, start a deck from it, then delete it", async ({ host }) => {
  const stamp = Date.now();
  const deckTitle = `E2E template source ${stamp}`;
  const templateName = `E2E team template ${stamp}`;
  await host.createDeck(deckTitle, [
    { type: "heading", content: { title: "Weekly sync", subtitle: "" } },
    { type: "wordcloud", question: "How was your week?", timeLimit: 0 },
  ]);

  const page = await host.open("/polls");
  await page.getByLabel("Search by title").fill(String(stamp));
  await page.getByRole("button", { name: `More actions for ${deckTitle}` }).click();
  await page.getByRole("menuitem", { name: "Save as template…" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as template" });
  await expect(dialog.getByLabel("Template name")).toHaveValue(deckTitle);
  await dialog.getByLabel("Template name").fill(templateName);
  await dialog.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Saved as a template.")).toBeVisible();
  // The template is not a library item.
  await page.getByLabel("Search by title").fill(templateName);
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();

  await page.goto("/templates");
  const saved = page.getByRole("region", { name: "Saved in this workspace" });
  const card = saved.getByRole("article").filter({ hasText: templateName });
  await expect(card).toBeVisible();
  await expect(card).toContainText("2 slides");
  await expect(card).toContainText("How was your week?");

  await card.getByRole("button", { name: `Use template ${templateName}` }).click();
  await expect(page).toHaveURL(/\/presentation\/create\?id=[a-f0-9]{24}/);
  await expect(page.getByLabel("Deck title")).toHaveValue(templateName);
  await expect(railItems(page)).toHaveCount(2);

  // Delete it through the app's own dialog; the deck made from it stays.
  const madeFrom = new URL(page.url()).searchParams.get("id")!;
  await page.goto("/templates");
  await page.getByRole("button", { name: `More actions for ${templateName}` }).click();
  await page.getByRole("menuitem", { name: "Delete template" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByText("Template deleted.")).toBeVisible();
  await expect(saved.getByRole("article").filter({ hasText: templateName })).toHaveCount(0);
  expect((await host.getDeck(madeFrom)).title).toBe(templateName);
});
