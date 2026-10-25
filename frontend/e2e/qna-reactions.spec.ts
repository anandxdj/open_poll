import { e2eEnv } from "./env";
import { expect, joinAsParticipant, openLobby, test, type Host } from "./fixtures";

/**
 * Q&A and reactions end to end: with moderation on a participant asks, the
 * host sees it waiting and approves it, a second participant upvotes it, the
 * host puts it on screen, then takes it down. A rejected anonymous question
 * never reaches the audience. Reactions sent from a phone float up the stage.
 */

const QUESTION = "How do reactions scale?";
const ANONYMOUS = "Who maintains this deck?";

const createDeck = async (host: Host, title: string) => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/presentations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.accessToken}` },
    body: JSON.stringify({
      title,
      slides: [
        { type: "qna", question: "Ask us anything", timeLimit: 0 },
        { type: "leaderboard", question: "Standings" },
      ],
      settings: {
        qna: { enabled: true, moderation: true, anonymousAllowed: true, upvotes: true },
        reactions: { enabled: true, emojis: ["👍", "🎉"] },
      },
    }),
  });
  const body = (await res.json()) as { data: { _id: string; joinCode: string; title: string } };
  if (!res.ok) throw new Error(`create deck failed: ${res.status} ${JSON.stringify(body)}`);
  return body.data;
};

test("a participant asks, the host approves, another upvotes, the host puts it on screen; reactions float up", async ({
  browser,
  contexts,
  host,
}) => {
  const deck = await createDeck(host, `E2E Q&A ${Date.now()}`);
  const hostPage = await host.open(`/presentation/host/${deck._id}`);
  const stage = hostPage.locator("main");
  await openLobby(hostPage, deck.joinCode);

  const ada = await joinAsParticipant(browser, contexts, deck.joinCode, "Ada");
  const grace = await joinAsParticipant(browser, contexts, deck.joinCode, "Grace");
  await expect(stage.getByText("2 JOINED")).toBeVisible();

  await hostPage.getByRole("button", { name: "Start", exact: true }).click();
  await expect(stage.getByText("SLIDE 1 OF 2")).toBeVisible();
  await expect(stage.getByText("Questions from the audience will show up here.")).toBeVisible();

  // --- Ada asks; with moderation on it waits for the host ---
  await ada.page.getByRole("button", { name: "Q&A", exact: true }).click();
  await expect(ada.page.getByText("The host reviews questions before they appear.")).toBeVisible();
  await ada.page.getByLabel("Your question").fill(QUESTION);
  await ada.page.getByRole("button", { name: "Send question" }).click();
  await expect(ada.page.getByText("Sent — waiting for the host to approve it.")).toBeVisible();
  await expect(ada.page.getByText(QUESTION)).toBeVisible();
  await expect(ada.page.getByText("Waiting for approval")).toBeVisible();

  // Grace asks anonymously; the host will reject it.
  await grace.page.getByRole("button", { name: "Q&A", exact: true }).click();
  // Ada's pending question is private to her and the host.
  await expect(grace.page.getByText("No questions yet. Be the first to ask.")).toBeVisible();
  await grace.page.getByLabel("Your question").fill(ANONYMOUS);
  await grace.page.getByLabel("Ask anonymously").check();
  await grace.page.getByRole("button", { name: "Send question" }).click();
  await expect(grace.page.getByText("Sent — waiting for the host to approve it.")).toBeVisible();

  // --- Host moderation ---
  const openPanel = hostPage.getByRole("button", { name: "Open Q&A panel" });
  await expect(openPanel).toContainText("2");
  await openPanel.click();
  const panel = hostPage.getByRole("complementary", { name: "Audience questions" });
  await expect(panel.getByRole("tab", { name: /Pending/ })).toContainText("2");
  await expect(panel.getByText(QUESTION)).toBeVisible();
  await expect(panel.getByText(ANONYMOUS)).toBeVisible();
  await expect(panel.getByText("Anonymous")).toBeVisible();
  // Nothing is on the stage board before approval.
  await expect(stage.getByText(QUESTION)).toBeHidden();

  await panel.getByRole("button", { name: `Reject: ${ANONYMOUS}` }).click();
  await expect(panel.getByText(ANONYMOUS)).toBeHidden();
  await panel.getByRole("button", { name: `Approve: ${QUESTION}` }).click();
  await expect(panel.getByText("Nothing waiting for approval.")).toBeVisible();

  // Approved: everyone sees it on the board and in their lists; the rejected one is gone.
  await expect(stage.getByText(QUESTION)).toBeVisible();
  await expect(ada.page.getByText("Waiting for approval")).toBeHidden();
  await expect(ada.page.getByText(QUESTION)).toBeVisible();
  await expect(grace.page.getByText(QUESTION)).toBeVisible();
  await expect(grace.page.getByText(ANONYMOUS)).toBeHidden();
  await expect(ada.page.getByText(ANONYMOUS)).toBeHidden();

  // --- Upvotes: not your own, one per participant ---
  const adaVote = ada.page.getByRole("button", { name: `Upvote: ${QUESTION}` });
  await expect(adaVote).toBeDisabled();
  const graceVote = grace.page.getByRole("button", { name: `Upvote: ${QUESTION}` });
  await graceVote.click();
  await expect(graceVote).toHaveAttribute("aria-pressed", "true");
  await expect(graceVote).toContainText("1");
  // The count reaches the other phone and the stage through the coalesced qna:votes event.
  await expect(adaVote).toContainText("1");
  await expect(stage.getByText("1 vote")).toBeAttached();
  await graceVote.click();
  await expect(graceVote).toHaveAttribute("aria-pressed", "false");
  await expect(adaVote).toContainText("0");
  await graceVote.click();
  await expect(adaVote).toContainText("1");

  // --- Put it on screen, then take it down ---
  await panel.getByRole("tab", { name: /Visible/ }).click();
  await panel.getByRole("button", { name: `Show on screen: ${QUESTION}` }).click();
  const onScreen = stage.locator("[data-qna-highlight]");
  await expect(onScreen).toContainText(QUESTION);
  await expect(onScreen).toContainText("Ada");
  await expect(ada.page.getByText("On screen")).toBeVisible();
  await expect(grace.page.getByText("On screen")).toBeVisible();

  await panel.getByRole("button", { name: `Hide from screen: ${QUESTION}` }).click();
  await expect(onScreen).toHaveCount(0);
  await expect(grace.page.getByText("On screen")).toBeHidden();

  // --- Mark answered: it stays visible, marked ---
  await panel.getByRole("button", { name: `Mark answered: ${QUESTION}` }).click();
  await expect(grace.page.getByText("Answered")).toBeVisible();

  // --- Reactions from a phone float up the stage ---
  await expect(stage.locator("[data-reaction-floater]")).toHaveCount(0);
  await grace.page.getByRole("button", { name: "Send reaction 🎉" }).click();
  await expect(stage.locator('[data-reaction-floater="🎉"]').first()).toBeVisible();
  // Emoji outside the deck's list never make it into the UI.
  await expect(grace.page.getByRole("button", { name: /Send reaction/ })).toHaveCount(2);
});

test("the builder turns Q&A and reactions on for the deck and adds a Q&A slide", async ({ host }) => {
  const deck = await host.createDeck(`E2E Q&A builder ${Date.now()}`, [
    {
      type: "select_answer",
      question: "Warm-up?",
      timeLimit: 10,
      options: [
        { text: "Yes", isCorrect: true },
        { text: "No", isCorrect: false },
      ],
    },
  ]);
  const page = await host.open(`/presentation/create?id=${deck._id}`);

  // Deck-level audience settings save as they change.
  await page.getByRole("tab", { name: "Audience" }).click();
  const qnaOn = page.getByRole("switch", { name: "Q&A during the whole session" });
  const moderation = page.getByRole("switch", { name: "Review questions first" });
  const reactions = page.getByRole("switch", { name: "Emoji reactions" });
  await expect(qnaOn).toHaveAttribute("aria-checked", "false");
  await qnaOn.click();
  await expect(qnaOn).toHaveAttribute("aria-checked", "true");
  await moderation.click();
  await expect(moderation).toHaveAttribute("aria-checked", "true");
  await reactions.click();
  await expect(reactions).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Reaction 🎉" }).click();
  await expect(page.getByRole("button", { name: "Reaction 🎉" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Changes save as you make them")).toBeVisible();

  await expect
    .poll(async () => {
      const saved = (await host.getDeck(deck._id)) as unknown as {
        settings: { qna: Record<string, boolean>; reactions: { enabled: boolean; emojis: string[] } };
      };
      return saved.settings;
    })
    .toMatchObject({
      qna: { enabled: true, moderation: true, anonymousAllowed: true, upvotes: true },
      reactions: { enabled: true, emojis: ["👍", "❤️", "😂", "😮", "👏", "🎉"] },
    });

  // A Q&A slide: optional heading, no timer or scoring tabs.
  await page.getByRole("button", { name: "New slide" }).click();
  await page.getByRole("button", { name: "Q&A", exact: true }).click();
  // The inspector keeps the chosen tab (Audience) across slides.
  await page.getByRole("tab", { name: "Content" }).click();
  await page.getByLabel("Heading").fill("Ask us anything");
  await expect(page.getByRole("tab", { name: "Settings" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Presentation deck updated!")).toBeVisible();

  const saved = await host.getDeck(deck._id);
  expect(saved.slides[1]).toMatchObject({ type: "qna", question: "Ask us anything", timeLimit: 0, points: 0 });
});
