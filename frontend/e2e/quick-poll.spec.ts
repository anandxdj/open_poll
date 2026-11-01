import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { dismissNativeDialogs, expect, test } from "./fixtures";

/**
 * A quick poll from the respondent's side and back: the host publishes a
 * poll, visitors with no account open its link and answer, and the host's
 * analytics page counts the responses. Covers anonymous and identified
 * (guest) voting, multi-select questions, closing a poll and publishing its
 * results.
 */

interface QuestionInput {
  text: string;
  options: string[];
  type?: "single" | "multiple";
  isMandatory?: boolean;
}

const teaOrCoffee: QuestionInput[] = [{ text: "Tea or coffee?", options: ["Tea", "Coffee"], type: "single" }];

async function createPoll(
  token: string,
  title: string,
  { isAnonymous = true, questions = teaOrCoffee }: { isAnonymous?: boolean; questions?: QuestionInput[] } = {}
) {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/polls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      isAnonymous,
      isPublished: true,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      questions,
    }),
  });
  const body = (await res.json()) as { data: { _id: string } };
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data;
}

/** Responses the public summary counts (the analytics worker flushes votes every ~2 s). */
async function countedResponses(pollId: string) {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/responses/poll/${pollId}/summary`);
  const body = (await res.json()) as { data: { totalResponses: number } };
  return body.data.totalResponses;
}

/** A visitor with no account: a fresh browser context, so a fresh device. */
async function newVisitor(browser: Browser, contexts: BrowserContext[]) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  dismissNativeDialogs(page);
  return page;
}

/** Another tab of the same browser: shares localStorage (the device), not sessionStorage. */
async function newTab(page: Page) {
  const tab = await page.context().newPage();
  dismissNativeDialogs(tab);
  return tab;
}

/** The value under a stat label (`<dt>label</dt><dd>value</dd>`) on analytics and results pages. */
const stat = (page: Page, label: string) =>
  page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

/** The chart card of one question; switch the page to the List view to read counts as text. */
const questionCard = (page: Page, text: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: text }) });

const optionRow = (card: ReturnType<typeof questionCard>, label: string) =>
  card.getByRole("listitem").filter({ hasText: new RegExp(`^${label}`) });

/** On the library page: More actions, Close poll, confirm in the app's dialog. */
async function closeFromLibrary(page: Page, title: string) {
  await page.getByLabel("Search by title").fill(title);
  await expect(page).toHaveURL(/[?&]q=/);
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toContainText("Active");
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Close poll" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close poll" }).click();
  await expect(page.getByText("Poll closed.")).toBeVisible();
  await expect(card).toContainText("Closed");
}

/** Identified poll: the guest gate, filled in and accepted. */
async function passGuestGate(page: Page, name: string, email: string) {
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue to the poll" }).click();
  await expect(page.getByText("Thanks. You can answer now.").first()).toBeVisible();
}

test("a visitor answers a published poll by link and the host sees the response", async ({ browser, contexts, host }) => {
  const title = `E2E quick poll ${Date.now()}`;
  const poll = await createPoll(host.accessToken, title);

  const context = await browser.newContext();
  contexts.push(context);
  const visitor = await context.newPage();
  dismissNativeDialogs(visitor);
  await visitor.goto(`/p/${poll._id}`);
  await expect(visitor.getByText("Tea or coffee?")).toBeVisible();
  await visitor.getByRole("button", { name: /Tea/ }).click();
  await expect(visitor.getByRole("heading", { name: "Your answers are in" })).toBeVisible();

  await visitor.getByRole("button", { name: "See live results" }).click();
  await expect(visitor.getByText("You've answered this poll. These are the results so far.")).toBeVisible();

  // Same device again: results, not the form.
  await visitor.reload();
  await expect(visitor.getByText("You've answered this poll. These are the results so far.")).toBeVisible();
  await expect(visitor.getByRole("button", { name: /Coffee/ })).toHaveCount(0);

  const analytics = await host.open(`/analytics/${poll._id}`);
  await expect(analytics.getByText(title).first()).toBeVisible();
  const responses = analytics.getByText("Responses", { exact: true }).locator("..");
  await expect(responses).toContainText("1");
});

test("POLL-08/09: an identified poll asks for a name and email first, and one person counts once", async ({
  browser,
  contexts,
  host,
}) => {
  const stamp = Date.now();
  const title = `E2E identified poll ${stamp}`;
  const question = "Should the offsite be in spring?";
  const name = "Ada Lovelace";
  const email = `ada.${stamp}@example.com`;
  const poll = await createPoll(host.accessToken, title, {
    isAnonymous: false,
    questions: [{ text: question, options: ["Spring", "Autumn"] }],
  });

  const tabA = await newVisitor(browser, contexts);
  await tabA.goto(`/p/${poll._id}`);
  // A second tab on the same device, opened before the first one answers.
  const tabB = await newTab(tabA);
  await tabB.goto(`/p/${poll._id}`);

  await test.step("POLL-08: name and a valid email come before the questions", async () => {
    await expect(tabA.getByText("Not anonymous")).toBeVisible();
    await expect(tabA.getByText("This poll records who answered. Add your name and email, or log in.")).toBeVisible();
    await expect(tabA.getByRole("heading", { name: question })).toHaveCount(0);

    await tabA.getByLabel("Full name").fill(name);
    await tabA.getByLabel("Email").fill("ada@example");
    await tabA.getByRole("button", { name: "Continue to the poll" }).click();
    await expect(tabA.getByText("Enter a valid email address.")).toBeVisible();
    await expect(tabA.getByRole("heading", { name: question })).toHaveCount(0);

    await passGuestGate(tabA, name, email);
    await expect(tabA.getByRole("heading", { name: question })).toBeVisible();
    await tabA.getByRole("button", { name: /Spring/ }).click();
    await expect(tabA.getByRole("heading", { name: "Your answers are in" })).toBeVisible();
  });

  await test.step("POLL-09: the other tab of the same device is refused", async () => {
    await expect(tabB.getByText("Not anonymous")).toBeVisible();
    await passGuestGate(tabB, name, email);
    await tabB.getByRole("button", { name: /Autumn/ }).click();
    await expect(tabB.getByText("You have already voted on this poll.")).toBeVisible();
    await expect(tabB.getByRole("heading", { name: "Your answers are in" })).toHaveCount(0);

    // Reopened, the device shows the results instead of the form.
    await tabB.reload();
    await expect(tabB.getByText("You've answered this poll. These are the results so far.")).toBeVisible();
    await expect(tabB.getByRole("button", { name: /Autumn/ })).toHaveCount(0);
  });

  await test.step("POLL-08: the same person on another device is refused too", async () => {
    const phone = await newVisitor(browser, contexts);
    await phone.goto(`/p/${poll._id}`);
    await passGuestGate(phone, name, email);
    await phone.getByRole("button", { name: /Autumn/ }).click();
    await expect(phone.getByText("You have already voted on this poll.")).toBeVisible();
  });

  await test.step("the host counts one identified response, from the guest", async () => {
    await expect.poll(() => countedResponses(poll._id)).toBe(1);
    const analytics = await host.open(`/analytics/${poll._id}`);
    await expect(stat(analytics, "Responses")).toHaveText("1");
    await expect(stat(analytics, "Respondents")).toHaveText("Identified");
    await analytics.getByRole("tab", { name: /Voters/ }).click();
    const rows = analytics.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(2); // header + one voter
    await expect(rows.nth(1)).toContainText(name);
    await expect(rows.nth(1)).toContainText(email);
    await expect(rows.nth(1)).toContainText("Guest");
  });
});

test("a multi-select question takes several answers, and an optional question can be skipped", async ({
  browser,
  contexts,
  host,
}) => {
  const title = `E2E multi-select poll ${Date.now()}`;
  const fruits = "Which fruits do you like?";
  const dessert = "Any dessert tonight?";
  const poll = await createPoll(host.accessToken, title, {
    questions: [
      { text: fruits, options: ["Apple", "Banana", "Cherry"], type: "multiple" },
      { text: dessert, options: ["Cake", "Pie"], isMandatory: false },
    ],
  });

  const visitor = await newVisitor(browser, contexts);
  await visitor.goto(`/p/${poll._id}`);
  await expect(visitor.getByRole("heading", { name: fruits })).toBeVisible();
  await expect(visitor.getByText("Choose all that apply")).toBeVisible();
  // Required: no Skip, and Next needs a choice.
  await expect(visitor.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await visitor.getByRole("button", { name: "Next question" }).click();
  await expect(visitor.getByText("Please select at least one option.")).toBeVisible();
  await expect(visitor.getByRole("heading", { name: fruits })).toBeVisible();

  const option = (label: string) => visitor.getByRole("button", { name: new RegExp(label) });
  for (const label of ["Apple", "Banana", "Cherry"]) await option(label).click();
  await option("Banana").click();
  await expect(option("Apple")).toHaveAttribute("aria-pressed", "true");
  await expect(option("Banana")).toHaveAttribute("aria-pressed", "false");
  await expect(option("Cherry")).toHaveAttribute("aria-pressed", "true");
  await visitor.getByRole("button", { name: "Next question" }).click();

  await expect(visitor.getByRole("heading", { name: dessert })).toBeVisible();
  await expect(visitor.getByText("2 of 2")).toBeVisible();
  // Back keeps the choices made.
  await visitor.getByRole("button", { name: "Back" }).click();
  await expect(option("Apple")).toHaveAttribute("aria-pressed", "true");
  await expect(option("Banana")).toHaveAttribute("aria-pressed", "false");
  await expect(option("Cherry")).toHaveAttribute("aria-pressed", "true");
  await visitor.getByRole("button", { name: "Next question" }).click();

  await expect(visitor.getByRole("heading", { name: dessert })).toBeVisible();
  await visitor.getByRole("button", { name: "Skip" }).click();
  await expect(visitor.getByRole("heading", { name: "Your answers are in" })).toBeVisible();

  await expect.poll(() => countedResponses(poll._id)).toBe(1);
  const analytics = await host.open(`/analytics/${poll._id}`);
  await expect(stat(analytics, "Responses")).toHaveText("1");
  await analytics.getByRole("group", { name: "Chart type" }).getByRole("button", { name: "List" }).click();
  const fruitCard = questionCard(analytics, fruits);
  await expect(fruitCard).toContainText("2 answers");
  await expect(optionRow(fruitCard, "Apple")).toContainText("1 (50%)");
  await expect(optionRow(fruitCard, "Banana")).toContainText("0 (0%)");
  await expect(optionRow(fruitCard, "Cherry")).toContainText("1 (50%)");
  const dessertCard = questionCard(analytics, dessert);
  await expect(dessertCard).toContainText("0 answers");
});

test("POLL-16/12: closing a poll in the library stops answers at once", async ({ browser, contexts, host }) => {
  const title = `E2E closing poll ${Date.now()}`;
  const poll = await createPoll(host.accessToken, title);

  // A visitor has the form open before the poll closes.
  const early = await newVisitor(browser, contexts);
  await early.goto(`/p/${poll._id}`);
  await expect(early.getByText("Tea or coffee?")).toBeVisible();

  const library = await host.open("/polls");
  await closeFromLibrary(library, title);

  await early.getByRole("button", { name: /Tea/ }).click();
  await expect(early.getByText("Poll is closed")).toBeVisible();
  await expect(early.getByRole("heading", { name: "Your answers are in" })).toHaveCount(0);

  const closedPage = async (page: Page) => {
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("This poll has ended or isn't taking answers right now.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Tea/ })).toHaveCount(0);
  };
  await early.reload();
  await closedPage(early);

  const late = await newVisitor(browser, contexts);
  await late.goto(`/p/${poll._id}`);
  await closedPage(late);

  await library.goto(`/analytics/${poll._id}`);
  await expect(stat(library, "Status")).toHaveText("Closed");
  await expect(stat(library, "Responses")).toHaveText("0");
  expect(await countedResponses(poll._id)).toBe(0);
});

test("POLL-15: results published from analytics are shown to a new visitor", async ({ browser, contexts, host }) => {
  const title = `E2E published results ${Date.now()}`;
  const poll = await createPoll(host.accessToken, title);

  const voter = await newVisitor(browser, contexts);
  await voter.goto(`/p/${poll._id}`);
  await voter.getByRole("button", { name: /Coffee/ }).click();
  await expect(voter.getByRole("heading", { name: "Your answers are in" })).toBeVisible();
  await expect.poll(() => countedResponses(poll._id)).toBe(1);

  // Results go public once the poll is closed.
  const hostPage = await host.open("/polls");
  await closeFromLibrary(hostPage, title);
  await hostPage.goto(`/analytics/${poll._id}`);
  await expect(stat(hostPage, "Status")).toHaveText("Closed");
  await expect(stat(hostPage, "Responses")).toHaveText("1");
  await hostPage.getByRole("button", { name: "Publish results" }).click();
  await expect(hostPage.getByText("Results are now public!")).toBeVisible();
  await expect(hostPage.getByText("Results are public", { exact: true })).toBeVisible();
  await expect(hostPage.getByRole("button", { name: "Publish results" })).toHaveCount(0);

  // Someone who never voted sees the results, not the form or the closed page.
  const newcomer = await newVisitor(browser, contexts);
  await newcomer.goto(`/p/${poll._id}`);
  await expect(newcomer.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(newcomer.getByText("Poll results", { exact: true })).toBeVisible();
  await expect(newcomer.getByText("You've answered this poll. These are the results so far.")).toHaveCount(0);
  await expect(newcomer.getByText("This poll has ended or isn't taking answers right now.")).toHaveCount(0);
  await expect(stat(newcomer, "Responses")).toHaveText("1");
  await newcomer.getByRole("group", { name: "Chart type" }).getByRole("button", { name: "List" }).click();
  const card = questionCard(newcomer, "Tea or coffee?");
  await expect(optionRow(card, "Coffee")).toContainText("1 (100%)");
  await expect(optionRow(card, "Tea")).toContainText("0 (0%)");
});

test("POLL-09: on an identified poll, the same email under another name still counts once", async ({
  browser,
  contexts,
  host,
}) => {
  const stamp = Date.now();
  const email = `grace.${stamp}@example.com`;
  const poll = await createPoll(host.accessToken, `E2E one email one vote ${stamp}`, { isAnonymous: false });

  const first = await newVisitor(browser, contexts);
  await first.goto(`/p/${poll._id}`);
  await passGuestGate(first, "Grace Hopper", email);
  await first.getByRole("button", { name: /Tea/ }).click();
  await expect(first.getByRole("heading", { name: "Your answers are in" })).toBeVisible();

  // Same email, the name typed differently, from another device.
  const again = await newVisitor(browser, contexts);
  await again.goto(`/p/${poll._id}`);
  await passGuestGate(again, "G. Hopper", email);
  await again.getByRole("button", { name: /Coffee/ }).click();
  await expect(again.getByText("You have already voted on this poll.")).toBeVisible();
  await expect(again.getByRole("heading", { name: "Your answers are in" })).toHaveCount(0);
});

test("POLL-09: an anonymous poll is an honour system across tabs; reopening shows results", async ({ browser, contexts, host }) => {
  // Owner decision (2026-11-01): anonymous votes are deduped per ballot plus a per-network cap,
  // never per device, so two tabs open at once can both answer. Strict counts use named polls.
  const poll = await createPoll(host.accessToken, `E2E anonymous two tabs ${Date.now()}`);

  // Both tabs load the form before either answers.
  const tabA = await newVisitor(browser, contexts);
  await tabA.goto(`/p/${poll._id}`);
  const tabB = await newTab(tabA);
  await tabB.goto(`/p/${poll._id}`);
  await expect(tabB.getByText("Tea or coffee?")).toBeVisible();

  await tabA.getByRole("button", { name: /Tea/ }).click();
  await expect(tabA.getByRole("heading", { name: "Your answers are in" })).toBeVisible();

  await tabB.getByRole("button", { name: /Coffee/ }).click();
  await expect(tabB.getByRole("heading", { name: "Your answers are in" })).toBeVisible();

  // A tab opened after answering gets the results, not the form.
  const tabC = await newTab(tabA);
  await tabC.goto(`/p/${poll._id}`);
  await expect(tabC.getByText("You've answered this poll. These are the results so far.")).toBeVisible();
  await expect(tabC.getByRole("button", { name: /Tea/ })).toHaveCount(0);
});
