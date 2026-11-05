import type { Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * W3-B2 templates: a starter template becomes a new draft deck that opens in
 * the builder with its slides, and a deck saved as a template from the
 * library is listed under "Saved in this workspace", used, then deleted. A
 * template opened by a direct link is offered as a template in the host
 * console and the builder, never presented or edited.
 */

const railItems = (page: Page) => page.getByRole("button", { name: /^Slide \d+ of \d+:/ });

async function saveAsTemplate(token: string, presentationId: string, title: string) {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ presentationId, title }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { _id: string } }).data._id;
}

async function deleteTemplate(token: string, id: string) {
  await fetch(`${e2eEnv.apiOrigin}/api/templates/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

test("a template behind a direct link is offered as a template, not presented or edited", async ({ host }) => {
  const stamp = Date.now();
  const source = await host.createDeck(`E2E linked source ${stamp}`, [
    { type: "heading", content: { title: "Kickoff", subtitle: "" } },
    { type: "wordcloud", question: "One word for the quarter?", timeLimit: 0 },
  ]);
  const templateName = `E2E linked template ${stamp}`;
  const templateId = await saveAsTemplate(host.accessToken, source._id, templateName);

  // Host console: no lobby, no start; Use template makes a deck and opens it in the builder.
  const hostPage = await host.open(`/presentation/host/${templateId}`);
  await expect(hostPage.getByRole("heading", { name: "This is a template" })).toBeVisible();
  await expect(hostPage.getByText(`“${templateName}” is a template`)).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Open lobby" })).toHaveCount(0);
  await expect(hostPage.getByRole("button", { name: "Start presenting" })).toHaveCount(0);
  await hostPage.getByRole("button", { name: "Use template" }).click();
  await expect(hostPage).toHaveURL(/\/presentation\/create\?id=[a-f0-9]{24}/);
  await expect(hostPage.getByLabel("Deck title")).toHaveValue(templateName);
  await expect(railItems(hostPage)).toHaveCount(2);
  const fromHost = new URL(hostPage.url()).searchParams.get("id")!;
  expect(fromHost).not.toBe(templateId);
  expect(await host.getSessions(templateId)).toEqual([]);

  // Builder: the template is not opened for editing; Use template opens a new deck instead.
  const builder = await host.open(`/presentation/create?id=${templateId}`);
  await expect(builder.getByRole("heading", { name: "This is a template" })).toBeVisible();
  await expect(builder.getByLabel("Deck title")).toHaveCount(0);
  await builder.getByRole("button", { name: "Use template" }).click();
  await expect(builder).toHaveURL(/\/presentation\/create\?id=[a-f0-9]{24}/);
  await expect(builder.getByLabel("Deck title")).toHaveValue(templateName);
  const fromBuilder = new URL(builder.url()).searchParams.get("id")!;
  expect([templateId, fromHost]).not.toContain(fromBuilder);
  expect((await host.getDeck(templateId)).title).toBe(templateName);

  await deleteTemplate(host.accessToken, templateId);
});

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
  // Every list refetch (the search above, the workspace becoming known) shows skeletons in place of
  // the cards, which unmounts an open card menu or dialog; the menu also only offers "Save as
  // template…" once the workspace role is known. Open it and pick the item until the dialog stays.
  await expect(async () => {
    if (await page.getByRole("dialog", { name: "Save as template" }).count()) return;
    if (await page.getByRole("menu").count()) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: `More actions for ${deckTitle}` }).click({ timeout: 2_000 });
    await page.getByRole("menuitem", { name: "Save as template…" }).click({ timeout: 2_000 });
    await expect(page.getByRole("dialog", { name: "Save as template" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
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
