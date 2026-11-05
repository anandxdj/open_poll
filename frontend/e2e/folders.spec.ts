import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * W3-B2 library folders as a creator uses them: create a folder, file a deck
 * and a poll into it from their card menus, filter the library by folder and
 * by "Not in a folder", rename the folder and delete it (its items go back to
 * the top level), every step through the app's own dialogs.
 */

const heading = { type: "heading", content: { title: "Folder check", subtitle: "" } };

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
  return ((await res.json()) as { data: { _id: string } }).data._id;
}

async function pollFolderId(token: string, id: string) {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/polls/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  return ((await res.json()) as { data: { folderId?: string | null } }).data.folderId ?? null;
}

test("create a folder, file a deck and a poll, filter by it, rename it and delete it", async ({ host }) => {
  const stamp = Date.now();
  const folderName = `E2E folder ${stamp}`;
  const renamed = `E2E renamed ${stamp}`;
  const deckTitle = `E2E filed deck ${stamp}`;
  const looseTitle = `E2E loose deck ${stamp}`;
  const pollTitle = `E2E filed poll ${stamp}`;
  const deck = await host.createDeck(deckTitle, [heading]);
  await host.createDeck(looseTitle, [heading]);
  const pollId = await createPoll(host.accessToken, pollTitle);

  const page = await host.open("/polls");
  const folders = page.getByRole("group", { name: "Folders" });

  // --- Create: the new folder opens, empty ---
  await page.getByRole("button", { name: "New folder" }).first().click();
  const create = page.getByRole("dialog", { name: "New folder" });
  await create.getByLabel("Folder name").fill(folderName);
  await create.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByText(`Folder “${folderName}” created.`)).toBeVisible();
  await expect(folders.getByRole("button", { name: new RegExp(`^${folderName} 0 items`), pressed: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This folder is empty" })).toBeVisible();

  // A second folder of the same name is refused in the dialog.
  await page.getByRole("button", { name: "New folder" }).click();
  await create.getByLabel("Folder name").fill(folderName.toUpperCase());
  await create.getByRole("button", { name: "Create folder" }).click();
  await expect(create.getByRole("alert")).toContainText("already exists");
  await create.getByRole("button", { name: "Cancel" }).click();

  // --- File the deck and the poll from their card menus ---
  await folders.getByRole("button", { name: "All items" }).click();
  await page.getByLabel("Search by title").fill(String(stamp));
  // Wait for the debounced search to reach the URL (and the list to reload) before opening card menus.
  await expect(page).toHaveURL(new RegExp(`q=${stamp}`));
  await expect(page.getByRole("tab", { name: /^All 3/ })).toBeVisible();
  await expect(page.getByText(looseTitle)).toBeVisible();
  for (const title of [deckTitle, pollTitle]) {
    await page.getByRole("button", { name: `More actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Move to folder…" }).click();
    const move = page.getByRole("dialog", { name: "Move to folder" });
    await move.getByText(folderName, { exact: true }).click();
    await move.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText(`Moved to “${folderName}”.`).first()).toBeVisible();
    await expect(move).toHaveCount(0);
  }
  // The cards say where they are while the list spans folders.
  const deckCard = page.getByRole("article").filter({ hasText: deckTitle });
  await expect(deckCard.getByText(`In folder ${folderName}`)).toBeVisible();

  // --- Filter by the folder, then by "Not in a folder" ---
  await folders.getByRole("button", { name: new RegExp(`^${folderName} 2 items`) }).click();
  await expect(page).toHaveURL(/folder=[a-f0-9]{24}/);
  await expect(page.getByText(deckTitle)).toBeVisible();
  await expect(page.getByText(pollTitle)).toBeVisible();
  await expect(page.getByText(looseTitle)).toHaveCount(0);

  await folders.getByRole("button", { name: "Not in a folder" }).click();
  await expect(page.getByText(looseTitle)).toBeVisible();
  await expect(page.getByText(deckTitle)).toHaveCount(0);
  await expect(page.getByText(pollTitle)).toHaveCount(0);

  // The filter survives a reload (it lives in the URL).
  await folders.getByRole("button", { name: new RegExp(`^${folderName}`) }).click();
  await page.reload();
  await expect(page.getByText(deckTitle)).toBeVisible();
  await expect(page.getByText(looseTitle)).toHaveCount(0);

  // --- Rename ---
  await folders.getByRole("button", { name: `Folder actions for ${folderName}` }).click();
  await page.getByRole("menuitem", { name: "Rename folder" }).click();
  const rename = page.getByRole("dialog", { name: "Rename folder" });
  await rename.getByLabel("Folder name").fill(renamed);
  await rename.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Folder renamed.")).toBeVisible();
  await expect(folders.getByRole("button", { name: new RegExp(`^${renamed} 2 items`), pressed: true })).toBeVisible();

  // --- Delete: the folder goes, its items stay at the top level ---
  await folders.getByRole("button", { name: `Folder actions for ${renamed}` }).click();
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Its 2 items stay in the library");
  await confirm.getByRole("button", { name: "Delete folder" }).click();
  await expect(page.getByText(`Folder “${renamed}” deleted.`)).toBeVisible();
  await expect(folders.getByRole("button", { name: new RegExp(`^${renamed}`) })).toHaveCount(0);
  await expect(page).not.toHaveURL(/folder=/);
  await page.getByLabel("Search by title").fill(String(stamp));
  await expect(page).toHaveURL(new RegExp(`q=${stamp}`));
  await expect(page.getByText(deckTitle)).toBeVisible();
  await expect(page.getByText(pollTitle)).toBeVisible();
  await expect(deckCard.getByText("In folder")).toHaveCount(0);

  expect((await host.getDeck(deck._id)) as unknown as { folderId: string | null }).toMatchObject({ folderId: null });
  expect(await pollFolderId(host.accessToken, pollId)).toBeNull();
});
