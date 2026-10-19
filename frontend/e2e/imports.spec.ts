import { expect, test } from "./fixtures";

/**
 * Imports: a questions CSV becomes a deck with the right slides (including
 * the rows that are skipped and why), the same file added to a deck open in
 * the builder, and the disabled-mode explanation for PowerPoint/PDF files when
 * the server has no storage (the e2e backend is started without S3_*).
 */

const CSV = [
  "type,question,option_1,option_2,option_3,correct,accepted_answers,statements,items,time_limit",
  "select_answer,Capital of France?,Paris,Rome,Madrid,1,,,,20",
  'multiple_choice,Pick the primes,2,4,5,"1,3",,,,',
  "type_answer,2 + 2 = ?,,,,,4|four,,,",
  "open_ended,Any questions?,,,,,,,,",
  "bogus,Unknown type,,,,,,,,",
  "select_answer,Only one option,A,,,1,,,,",
].join("\r\n");

const csvFile = { name: "quiz.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) };

test("a questions CSV becomes a deck with the right slides", async ({ host }) => {
  const page = await host.open("/polls");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("tab", { name: "Questions (CSV or Excel)" }).click();
  await dialog.locator('input[type="file"]').setInputFiles(csvFile);

  // The file is checked first: what will be imported, and what will not and why.
  await expect(dialog.getByText("4 questions are ready to import")).toBeVisible();
  await expect(dialog.getByText("2 rows have problems and will be skipped")).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "Capital of France?" })).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "Multiple choice" }).first()).toBeVisible();
  await expect(dialog.getByText(/Row 6: type "bogus" is not one of/)).toBeVisible();
  await expect(dialog.getByText(/Row 7: Select-answer slides need at least 2 options/)).toBeVisible();

  const title = `E2E questions ${Date.now()}`;
  await dialog.getByLabel("Deck title (optional)").fill(title);
  await dialog.getByRole("button", { name: "Import 4 questions" }).click();
  await expect(dialog.getByText("4 questions imported.")).toBeVisible();
  await expect(dialog.getByText("2 rows were skipped.")).toBeVisible();

  const href = await dialog.getByRole("link", { name: "Open the deck" }).getAttribute("href");
  const id = new URL(href!, "http://localhost").searchParams.get("id")!;
  const deck = await host.getDeck(id);
  expect(deck.title).toBe(title);
  expect(deck.slides.map((slide) => [slide.type, slide.question])).toEqual([
    ["select_answer", "Capital of France?"],
    ["select_answer", "Pick the primes"],
    ["type_answer", "2 + 2 = ?"],
    ["open_ended", "Any questions?"],
  ]);
  expect(deck.slides[0]).toMatchObject({
    timeLimit: 20,
    options: [
      { text: "Paris", isCorrect: true },
      { text: "Rome", isCorrect: false },
      { text: "Madrid", isCorrect: false },
    ],
  });
  expect(deck.slides[1]).toMatchObject({ config: { allowMultiple: true } });
  expect(deck.slides[2]).toMatchObject({ acceptedAnswers: ["4", "four"] });

  await dialog.getByRole("link", { name: "Open the deck" }).click();
  await expect(page).toHaveURL(new RegExp(`/presentation/create\\?id=${id}`));
  await expect(page.getByLabel("Deck title")).toHaveValue(title);
});

test("the question templates download", async ({ host }) => {
  const page = await host.open("/polls");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import" });
  await dialog.getByRole("tab", { name: "Questions (CSV or Excel)" }).click();

  for (const [button, filename] of [
    ["CSV template", "openpoll-questions-template.csv"],
    ["Excel template", "openpoll-questions-template.xlsx"],
  ] as const) {
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: button }).click();
    expect((await download).suggestedFilename()).toBe(filename);
  }
});

test("a file that is not a questions spreadsheet is refused with a reason", async ({ host }) => {
  const page = await host.open("/polls");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import" });
  await dialog.getByRole("tab", { name: "Questions (CSV or Excel)" }).click();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(dialog.getByText("That file type is not supported. Choose a .csv or .xlsx file.")).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles({ name: "q.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\r\n1,2") });
  await expect(dialog.getByRole("alert").filter({ hasText: "must name the columns type and question" })).toBeVisible();
});

test("PowerPoint and PDF import explain that file storage is not set up", async ({ host }) => {
  const page = await host.open("/polls");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import" });

  await expect(dialog.getByText("File uploads are not set up")).toBeVisible();
  await expect(dialog.getByText(/File storage is not configured on this server/)).toBeVisible();
  await expect(dialog.locator('input[type="file"]')).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Import file" })).toBeDisabled();

  // A Google Slides link needs no storage: only its format is checked before it is sent.
  await dialog.getByRole("tab", { name: "Google Slides" }).click();
  await dialog.getByLabel("Google Slides link").fill("https://example.com/not-slides");
  await dialog.getByLabel("Google Slides link").blur();
  await expect(dialog.getByRole("alert")).toContainText("That is not a Google Slides link");
  await expect(dialog.getByRole("button", { name: "Import from Google Slides" })).toBeDisabled();
});

test("questions can be added to the deck open in the builder", async ({ host }) => {
  const deck = await host.createDeck(`E2E builder import ${Date.now()}`, [
    { type: "open_ended", question: "Existing question", timeLimit: 0 },
  ]);
  const page = await host.open(`/presentation/create?id=${deck._id}`);
  await expect(page.getByLabel("Deck title")).toHaveValue(deck.title);

  await page.getByRole("button", { name: "Import questions" }).click();
  const dialog = page.getByRole("dialog", { name: "Import questions" });
  await dialog.locator('input[type="file"]').setInputFiles(csvFile);
  await expect(dialog.getByText("4 questions are ready to import")).toBeVisible();
  await dialog.getByRole("button", { name: "Add 4 questions" }).click();
  await expect(dialog.getByText("Added 4 questions to the deck.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  // The builder saved them as a draft of the same deck: the old slide first, then the new ones.
  await expect
    .poll(async () => (await host.getDeck(deck._id)).slides.map((slide) => slide.question))
    .toEqual(["Existing question", "Capital of France?", "Pick the primes", "2 + 2 = ?", "Any questions?"]);
});
