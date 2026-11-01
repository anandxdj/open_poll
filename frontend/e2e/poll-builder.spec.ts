import { addDays, format } from "date-fns";
import type { Page } from "@playwright/test";
import { dismissNativeDialogs, expect, test } from "./fixtures";

/**
 * The quick-poll builder at /create as a creator uses it: write a poll with the
 * phone preview following along (POLL-01), save it as a draft and reopen it from
 * the library (POLL-02), and publish it through the publish settings (POLL-03).
 */

const questionBox = (page: Page) => page.getByLabel("Question", { exact: true });
const choice = (page: Page, n: number) => page.getByRole("textbox", { name: `Choice ${n}`, exact: true });
const preview = (page: Page) => page.getByRole("img", { name: /on a respondent's phone$/ });
const rail = (page: Page) => page.getByRole("list", { name: "Questions" });

/** Fills the question on screen; choices past the first two are added first. */
async function fillQuestion(page: Page, text: string, options: string[]) {
  await questionBox(page).fill(text);
  for (const [i, option] of options.entries()) {
    if (i >= 2) await page.getByRole("button", { name: "Add choice" }).click();
    await choice(page, i + 1).fill(option);
  }
}

/** Library search; returns the card of the item with this title once the search has applied. */
async function findInLibrary(page: Page, title: string) {
  await page.getByLabel("Search by title").fill(title);
  // The search reaches the URL after a 300 ms pause; acting on a card before then races it.
  await expect(page).toHaveURL(/[?&]q=/);
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toHaveCount(1);
  return card;
}

/** The on/off switch in the publish settings row that carries this label. */
const settingSwitch = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).locator("xpath=ancestor::div[.//button[@role='switch']][1]").getByRole("switch");

test("POLL-01/02: build a poll with the phone preview, save it as a draft and reopen it from the library", async ({ host }) => {
  const stamp = Date.now();
  const title = `E2E builder poll ${stamp}`;
  const q1 = "Which drink keeps you going?";
  const q2 = "Where should we meet next?";

  const page = await host.open("/create");

  await test.step("POLL-01: an empty poll cannot be published and the preview shows placeholders", async () => {
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    await expect(preview(page)).toContainText("Untitled poll");
    await expect(preview(page)).toContainText("Your question will appear here…");
    await expect(preview(page)).toContainText("1 of 1");
  });

  await test.step("POLL-01: title, first question and its choices; a removed choice leaves the preview", async () => {
    await page.getByLabel("Poll title").fill(title);
    await expect(preview(page)).toContainText(title);

    await fillQuestion(page, q1, ["Tea", "Juice", "Coffee"]);
    await expect(preview(page)).toContainText(q1);
    for (const option of ["Tea", "Juice", "Coffee"]) await expect(preview(page)).toContainText(option);
    await expect(preview(page)).toContainText("Submit");

    await page.getByRole("button", { name: "Remove choice 2" }).click();
    await expect(choice(page, 3)).toHaveCount(0);
    await expect(choice(page, 1)).toHaveValue("Tea");
    await expect(choice(page, 2)).toHaveValue("Coffee");
    await expect(preview(page)).not.toContainText("Juice");
    // Two choices is the floor: they cannot be removed.
    await expect(page.getByRole("button", { name: /Remove choice/ })).toHaveCount(0);

    await expect(page.getByRole("switch", { name: "Required" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  });

  await test.step("POLL-01: a second, optional question", async () => {
    await page.getByRole("button", { name: "Add question" }).click();
    // The new card replaces the first one (wait for it, or typing lands on the old card).
    await expect(questionBox(page)).toHaveValue("");
    await expect(preview(page)).toContainText("2 of 2");
    await expect(preview(page)).toContainText("Your question will appear here…");
    // An unfinished question blocks publishing.
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();

    await fillQuestion(page, q2, ["Office", "Park"]);
    await page.getByRole("switch", { name: "Required" }).click();
    await expect(page.getByRole("switch", { name: "Required" })).not.toBeChecked();

    await expect(preview(page)).toContainText(q2);
    await expect(preview(page)).toContainText("Office");
    await expect(preview(page)).toContainText("Park");
    await expect(preview(page)).toContainText("Submit");

    await expect(rail(page).getByRole("listitem")).toHaveCount(2);
    await expect(rail(page).getByRole("listitem").nth(0)).toContainText("Required");
    await expect(rail(page).getByRole("listitem").nth(1)).not.toContainText("Required");
    await expect(page.getByText("Ready to publish", { exact: true }).locator("..")).toContainText("2 of 2");
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  });

  await test.step("POLL-01: going back to question 1 moves the preview with it", async () => {
    await rail(page).getByRole("button", { name: new RegExp(q1) }).click();
    await expect(questionBox(page)).toHaveValue(q1);
    await expect(preview(page)).toContainText("1 of 2");
    await expect(preview(page)).toContainText(q1);
    await expect(preview(page)).toContainText("Next");
    await expect(preview(page)).not.toContainText(q2);
  });

  let draftId = "";
  await test.step("POLL-02: save as a draft", async () => {
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved to drafts")).toBeVisible();
    await expect(page).toHaveURL(/[?&]draftId=[0-9a-f]{24}/);
    draftId = new URL(page.url()).searchParams.get("draftId") ?? "";
  });

  await test.step("POLL-02: the library lists it as a draft and reopens it", async () => {
    await page.getByRole("button", { name: "Back to polls" }).click();
    await expect(page).toHaveURL(/\/polls/);
    const card = await findInLibrary(page, title);
    await expect(card).toContainText("Draft");
    await expect(card).toContainText("2 questions");
    await card.getByRole("link", { name: "Edit draft" }).click();
    await expect(page).toHaveURL(new RegExp(`/create\\?draftId=${draftId}$`));
  });

  const expectSavedPoll = async () => {
    await expect(page.getByLabel("Poll title")).toHaveValue(title);
    await expect(rail(page).getByRole("listitem")).toHaveCount(2);
    await expect(questionBox(page)).toHaveValue(q1);
    await expect(choice(page, 1)).toHaveValue("Tea");
    await expect(choice(page, 2)).toHaveValue("Coffee");
    await expect(choice(page, 3)).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Required" })).toBeChecked();

    await rail(page).getByRole("button", { name: new RegExp(q2) }).click();
    await expect(questionBox(page)).toHaveValue(q2);
    await expect(choice(page, 1)).toHaveValue("Office");
    await expect(choice(page, 2)).toHaveValue("Park");
    await expect(page.getByRole("switch", { name: "Required" })).not.toBeChecked();
    await expect(preview(page)).toContainText(title);
    await expect(preview(page)).toContainText(q2);
  };

  await test.step("POLL-02: the reopened draft holds every edit", expectSavedPoll);

  await test.step("POLL-02: and so does a fresh load of its link", async () => {
    await page.reload();
    await expectSavedPoll();
  });
});

test("POLL-03: publish an identified poll from the publish settings; the library shows it Active and its link opens", async ({
  browser,
  contexts,
  host,
}) => {
  const title = `E2E published poll ${Date.now()}`;
  const page = await host.open("/create");
  await page.getByLabel("Poll title").fill(title);
  await fillQuestion(page, "Should Friday demos move to Thursday?", ["Yes", "No"]);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Publish settings", { exact: true })).toBeVisible();
  await expect(page.getByText("Poll Closes At")).toBeVisible();

  const anonymous = settingSwitch(page, "Anonymous responses");
  await expect(anonymous).toBeChecked();
  await expect(page.getByText("Responses are fully anonymous")).toBeVisible();
  await anonymous.click();
  await expect(anonymous).not.toBeChecked();
  await expect(page.getByText("You see each voter's name and email")).toBeVisible();

  await expect(settingSwitch(page, "Publish immediately")).toBeChecked();
  await expect(page.getByText("Poll will go live immediately after publishing")).toBeVisible();

  await page.getByRole("button", { name: "Publish Poll" }).click();
  await expect(page.getByText("Poll published!")).toBeVisible();
  await expect(page).toHaveURL(/\/polls$/);

  const card = await findInLibrary(page, title);
  await expect(card).toContainText("Active");
  await expect(card).toContainText("Verified");
  await expect(card).toContainText("1 question");
  await expect(card.getByRole("button", { name: "Share" })).toBeVisible();
  const analyticsHref = await card.getByRole("link", { name: "Analytics" }).getAttribute("href");
  const pollId = analyticsHref?.match(/^\/analytics\/([0-9a-f]{24})$/)?.[1];
  expect(pollId, `analytics link ${analyticsHref}`).toBeTruthy();

  // The share link works for someone with no account, and asks who they are.
  const context = await browser.newContext();
  contexts.push(context);
  const visitor = await context.newPage();
  dismissNativeDialogs(visitor);
  await visitor.goto(`/p/${pollId}`);
  await expect(visitor.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(visitor.getByText("Not anonymous")).toBeVisible();
  await expect(visitor.getByLabel("Full name")).toBeVisible();
});

test("POLL-03: a closing date picked in the publish settings is the one the poll gets", async ({ host }) => {
  const title = `E2E closing date ${Date.now()}`;
  const page = await host.open("/create");
  await page.getByLabel("Poll title").fill(title);
  await fillQuestion(page, "Is tomorrow a good deadline?", ["Yes", "No"]);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Publish settings", { exact: true })).toBeVisible();

  // Default: a week from now. Pick tomorrow instead.
  const tomorrow = addDays(new Date(), 1);
  await page.getByRole("button", { name: format(addDays(new Date(), 7), "PPP"), exact: true }).click();
  const day = page.getByRole("button", { name: format(tomorrow, "PPPP") });
  await expect(page.getByRole("grid")).toBeVisible();
  if (!(await day.isVisible())) await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await day.click({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: format(tomorrow, "PPP"), exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish Poll" }).click();
  await expect(page.getByText("Poll published!")).toBeVisible();
  const card = await findInLibrary(page, title);
  await expect(card).toContainText(/Closes in (2[34] hours|1 day)/);
});
