import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createInitialLiveState,
  liveReducer,
  type LiveAction,
  type LiveState,
} from "@/features/presentations/live/reducer";
import type { PresentationRealtimeEvent } from "@/features/presentations/types";
import { registerQnaModule } from "@/features/qna/module";
import {
  highlightedItem,
  initialQnaState,
  isQnaOpen,
  qnaActions,
  questionsWithStatus,
  sortQuestions,
  type QnaState,
} from "@/features/qna/state";
import type {
  QnaHostListResponse,
  QnaParticipantListResponse,
  QnaParticipantQuestion,
  QnaQuestionView,
  QnaSettingsView,
} from "@/features/qna/types";

let dispose: () => void;
beforeAll(() => {
  dispose = registerQnaModule();
});
afterAll(() => dispose());

const PID = "64b000000000000000000001";
const SID = "64b0000000000000000000a1";

/** A surface that follows session SID: the reducer ignores events of any other session. */
const fresh = (role: "host" | "participant") => createInitialLiveState(role, { sessionId: SID });

const view = (over: Partial<QnaQuestionView> = {}): QnaQuestionView => ({
  id: "q1",
  sessionId: SID,
  slideId: null,
  text: "How does it scale?",
  authorName: "Ada",
  anonymous: false,
  status: "visible",
  pinned: false,
  upvoteCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  answeredAt: null,
  ...over,
});

const settings = (over: Partial<QnaSettingsView> = {}): QnaSettingsView => ({
  enabled: true,
  moderation: false,
  anonymousAllowed: true,
  upvotes: true,
  open: true,
  onBoard: false,
  hasBoard: false,
  ...over,
});

const event = (type: string, payload: Record<string, unknown>, sessionId: string | undefined = SID): LiveAction => ({
  type: "live/event",
  event: {
    quizId: PID,
    presentationId: PID,
    type,
    payload,
    emittedAt: "2026-01-01T00:00:00.000Z",
    ...(sessionId ? { sessionId } : {}),
  } as PresentationRealtimeEvent,
});

const run = (state: LiveState, ...actions: LiveAction[]) => actions.reduce(liveReducer, state);
const qnaOf = (state: LiveState) => state.modules.qna as QnaState;

const participantList = (questions: QnaParticipantQuestion[] = [], over: Partial<QnaParticipantListResponse> = {}): LiveAction =>
  qnaActions.loadedForParticipant({
    sessionId: SID,
    qna: settings(),
    reactions: { enabled: true, emojis: ["👍", "🎉"] },
    highlightedId: null,
    questions,
    ...over,
  });

const hostList = (over: Partial<QnaHostListResponse> = {}): LiveAction =>
  qnaActions.loadedForHost({ sessionId: SID, qna: settings({ moderation: true }), highlightedId: null, questions: [], ...over });

const mine = (over: Partial<QnaQuestionView> = {}): QnaParticipantQuestion => ({ ...view(over), mine: true, upvoted: false });

describe("qna slice registration", () => {
  test("every live state starts with an unloaded slice", () => {
    expect(qnaOf(fresh("participant"))).toEqual(initialQnaState);
    expect(qnaOf(fresh("host")).loaded).toBe(false);
  });

  test("events of other modules leave the state untouched", () => {
    const state = fresh("participant");
    expect(liveReducer(state, event("answer:received", { answeredCount: 1 }))).toBe(state);
    expect(liveReducer(state, event("qna:question", {}))).toBe(state);
  });
});

describe("loading", () => {
  test("a participant list fills settings, reactions, questions and the highlight", () => {
    const state = run(
      fresh("participant"),
      participantList([mine(), { ...view({ id: "q2", authorName: "Grace" }), mine: false, upvoted: true }], {
        highlightedId: "q2",
      })
    );
    const qna = qnaOf(state);
    expect(qna.loaded).toBe(true);
    expect(qna.sessionId).toBe(SID);
    expect(qna.reactions).toEqual({ enabled: true, emojis: ["👍", "🎉"] });
    expect(Object.keys(qna.items)).toEqual(["q1", "q2"]);
    expect(qna.items.q2).toMatchObject({ mine: false, upvoted: true });
    expect(highlightedItem(qna)?.id).toBe("q2");
  });

  test("a host list keeps the reactions of an earlier participant-style load out of the way", () => {
    const state = run(fresh("host"), hostList({ questions: [{ ...view(), participantId: "p1", highlighted: false }] }));
    expect(qnaOf(state).items.q1.participantId).toBe("p1");
    expect(qnaOf(state).reactions).toBeNull();
  });

  test("loading again replaces the questions", () => {
    const state = run(fresh("participant"), participantList([mine()]), participantList([]));
    expect(Object.keys(qnaOf(state).items)).toEqual([]);
  });

  test("a new lobby or session resets the slice so the surface reloads", () => {
    const loaded = run(fresh("participant"), participantList([mine()]));
    expect(qnaOf(run(loaded, event("session:lobby", { runNumber: 2 }))).loaded).toBe(false);
    expect(qnaOf(run(loaded, event("session:lobby", { runNumber: 2 }))).items).toEqual({});
    // The legacy copy changes nothing (the core reducer ignores it too).
    expect(qnaOf(run(loaded, event("lobby:opened", { joinCode: "1" }))).loaded).toBe(true);
  });
});

describe("live events", () => {
  test("qna:question adds a question and keeps what the asker already knows", () => {
    const asked = run(fresh("participant"), participantList(), qnaActions.asked(mine({ upvoteCount: 0 })));
    expect(qnaOf(asked).items.q1).toMatchObject({ mine: true, upvoted: false });
    // The same question arriving as an event must not erase `mine`.
    const again = run(asked, event("qna:question", { question: view({ upvoteCount: 1 }) }));
    expect(qnaOf(again).items.q1).toMatchObject({ mine: true, upvoteCount: 1 });
    // Someone else's question arrives without the flags.
    const other = run(again, event("qna:question", { question: view({ id: "q9", authorName: "Grace" }) }));
    expect(qnaOf(other).items.q9.mine).toBeUndefined();
  });

  test("a host sees pending questions arrive", () => {
    const state = run(fresh("host"), hostList(), event("qna:question", { question: view({ status: "pending" }) }));
    expect(questionsWithStatus(qnaOf(state), "pending")).toHaveLength(1);
  });

  test("approval reaches a participant who has not seen the question", () => {
    const state = run(fresh("participant"), participantList(), event("qna:updated", { question: view({ id: "q7" }) }));
    expect(qnaOf(state).items.q7.status).toBe("visible");
  });

  test("a question leaving the public lists disappears for others but not for its author", () => {
    const base = run(
      fresh("participant"),
      participantList([mine({ id: "mine" }), { ...view({ id: "other" }), mine: false, upvoted: false }])
    );
    const archived = run(
      base,
      event("qna:updated", { question: view({ id: "other", status: "archived" }) }),
      event("qna:updated", { question: view({ id: "mine", status: "rejected" }) })
    );
    expect(qnaOf(archived).items.other).toBeUndefined();
    expect(qnaOf(archived).items.mine.status).toBe("rejected");
  });

  test("a host keeps archived questions", () => {
    const state = run(
      fresh("host"),
      hostList({ questions: [{ ...view(), participantId: "p1", highlighted: false }] }),
      event("qna:updated", { question: view({ status: "archived" }) })
    );
    expect(qnaOf(state).items.q1.status).toBe("archived");
  });

  test("votes update known questions only and keep identities when nothing changes", () => {
    const loaded = run(fresh("participant"), participantList([mine({ upvoteCount: 2 })]));
    const voted = run(loaded, event("qna:votes", { votes: [{ id: "q1", upvoteCount: 5 }, { id: "ghost", upvoteCount: 9 }] }));
    expect(qnaOf(voted).items.q1.upvoteCount).toBe(5);
    expect(qnaOf(voted).items.ghost).toBeUndefined();
    expect(liveReducer(voted, event("qna:votes", { votes: [{ id: "q1", upvoteCount: 5 }] }))).toBe(voted);
    expect(liveReducer(voted, event("qna:votes", { votes: "nope" }))).toBe(voted);
  });

  test("an own vote from the API response sets the flag and the count", () => {
    const loaded = run(fresh("participant"), participantList([{ ...view(), mine: false, upvoted: false }]));
    const voted = run(loaded, qnaActions.voted({ questionId: "q1", upvoted: true, upvoteCount: 3 }));
    expect(qnaOf(voted).items.q1).toMatchObject({ upvoted: true, upvoteCount: 3 });
    expect(run(loaded, qnaActions.voted({ questionId: "gone", upvoted: true, upvoteCount: 1 }))).toBe(loaded);
  });

  test("highlight sets, replaces and clears the question over the stage", () => {
    const loaded = run(fresh("participant"), participantList([{ ...view(), mine: false, upvoted: false }]));
    const shown = run(loaded, event("qna:highlight", { question: view({ id: "q5", text: "Why?" }) }));
    expect(highlightedItem(qnaOf(shown))).toMatchObject({ id: "q5", text: "Why?" });
    const cleared = run(shown, event("qna:highlight", { question: null }));
    expect(highlightedItem(qnaOf(cleared))).toBeNull();
    expect(liveReducer(cleared, event("qna:highlight", { question: null }))).toBe(cleared);
  });

  test("a highlighted question that is archived leaves the stage", () => {
    const shown = run(fresh("host"), hostList(), event("qna:highlight", { question: view() }));
    const archived = run(shown, event("qna:updated", { question: view({ status: "archived" }) }));
    expect(qnaOf(archived).highlightedId).toBeNull();
  });

  test("host actions merge the server's answer, including the highlight", () => {
    const state = run(
      fresh("host"),
      hostList(),
      qnaActions.hostUpdated({ ...view(), participantId: "p1", highlighted: true }),
    );
    expect(qnaOf(state).highlightedId).toBe("q1");
    const off = run(state, qnaActions.hostUpdated({ ...view(), participantId: "p1", highlighted: false }));
    expect(qnaOf(off).highlightedId).toBeNull();
  });

  test("events of another session are ignored once the slice knows its own", () => {
    const loaded = run(fresh("participant"), participantList());
    expect(liveReducer(loaded, event("qna:question", { question: view({ id: "old" }) }, "64b0000000000000000000ff"))).toBe(loaded);
    expect(qnaOf(run(loaded, event("qna:question", { question: view({ id: "new" }) }, undefined))).items.new).toBeDefined();
  });
});

describe("when Q&A is open", () => {
  const open = (state: LiveState, status: LiveState["status"]) => isQnaOpen(qnaOf(state), status);

  test("nothing is open before the list loaded or after the session ended", () => {
    expect(isQnaOpen(initialQnaState, "active")).toBe(false);
    const loaded = run(fresh("participant"), participantList());
    expect(open(loaded, "active")).toBe(true);
    expect(open(loaded, "ended")).toBe(false);
  });

  test("with Q&A off for the deck, only a Q&A slide on screen opens it", () => {
    const off = run(fresh("participant"), participantList([], { qna: settings({ enabled: false, open: false, hasBoard: true }) }));
    expect(open(off, "active")).toBe(false);
    const board = run(off, event("slide:shown", { slide: { type: "qna" } }));
    expect(open(board, "active")).toBe(true);
    const next = run(board, event("question:started", { slide: { type: "select_answer" } }));
    expect(open(next, "active")).toBe(false);
    expect(open(run(board, event("leaderboard:shown", {})), "active")).toBe(false);
    expect(open(run(board, event("session:ended", {})), "active")).toBe(false);
  });

  test("a list fetched while the board is on screen says so", () => {
    const state = run(fresh("participant"), participantList([], { qna: settings({ enabled: false, onBoard: true }) }));
    expect(open(state, "active")).toBe(true);
  });
});

describe("ordering", () => {
  const items = [
    { ...view({ id: "a", upvoteCount: 1, createdAt: "2026-01-01T00:00:01.000Z" }) },
    { ...view({ id: "b", upvoteCount: 5, createdAt: "2026-01-01T00:00:02.000Z" }) },
    { ...view({ id: "c", upvoteCount: 5, createdAt: "2026-01-01T00:00:03.000Z" }) },
    { ...view({ id: "d", upvoteCount: 0, createdAt: "2026-01-01T00:00:04.000Z", pinned: true }) },
  ];

  test("top: pinned first, then votes, ties newest first", () => {
    expect(sortQuestions(items, "top").map((q) => q.id)).toEqual(["d", "c", "b", "a"]);
  });

  test("new: pinned first, then newest", () => {
    expect(sortQuestions(items, "new").map((q) => q.id)).toEqual(["d", "c", "b", "a"]);
    const plain = items.map((q) => ({ ...q, pinned: false }));
    expect(sortQuestions(plain, "new").map((q) => q.id)).toEqual(["d", "c", "b", "a"]);
  });

  test("does not reorder its input", () => {
    const copy = [...items];
    sortQuestions(items, "top");
    expect(items).toEqual(copy);
  });
});
