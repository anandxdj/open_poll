import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { registerQnaModule } from "@/features/qna/module";
import { apiClient } from "@/lib/api-client";
import { createLiveStore } from "@/features/presentations/live/store";
import {
  askQuestion,
  highlightHostQuestion,
  listHostQuestions,
  listQuestions,
  setUpvote,
  updateHostQuestion,
} from "@/features/qna/api";
import type { QnaState } from "@/features/qna/state";
import { loadQna } from "@/features/qna/useQnaSync";

let dispose: () => void;
beforeAll(() => {
  dispose = registerQnaModule();
});
afterAll(() => dispose());

const WHO = { participantId: "p1", token: "t".repeat(32) };
const HEADERS = { "X-Participant-Id": "p1", "X-Participant-Token": "t".repeat(32) };

const ok = (data: unknown) => ({ data: { success: true, message: "", data } });

const settings = { enabled: true, moderation: false, anonymousAllowed: true, upvotes: true, open: true, onBoard: false, hasBoard: false };

afterEach(() => {
  for (const method of ["get", "post", "patch", "delete"] as const) {
    const spy = apiClient[method] as unknown as { mockRestore?: () => void };
    spy.mockRestore?.();
  }
});

describe("Q&A API client", () => {
  test("participant calls carry the credentials as headers, never in the URL or body", async () => {
    const get = spyOn(apiClient, "get").mockResolvedValue(ok({ questions: [] }));
    const post = spyOn(apiClient, "post").mockResolvedValue(ok({ id: "q1" }));
    const del = spyOn(apiClient, "delete").mockResolvedValue(ok({ questionId: "q1", upvoted: false, upvoteCount: 0 }));

    await listQuestions("deck", WHO);
    expect(get).toHaveBeenCalledWith("/presentations/deck/qna", { headers: HEADERS });

    await askQuestion("deck", WHO, { text: "Why?", anonymous: true });
    expect(post).toHaveBeenCalledWith("/presentations/deck/qna", { text: "Why?", anonymous: true }, { headers: HEADERS });

    await setUpvote("deck", WHO, "q1", true);
    expect(post).toHaveBeenLastCalledWith("/presentations/deck/qna/q1/upvote", undefined, { headers: HEADERS });
    await setUpvote("deck", WHO, "q1", false);
    expect(del).toHaveBeenCalledWith("/presentations/deck/qna/q1/upvote", { headers: HEADERS });
  });

  test("host calls use the host routes and the status filter", async () => {
    const get = spyOn(apiClient, "get").mockResolvedValue(ok({ questions: [] }));
    const patch = spyOn(apiClient, "patch").mockResolvedValue(ok({ id: "q1" }));
    const post = spyOn(apiClient, "post").mockResolvedValue(ok({ id: "q1" }));

    await listHostQuestions("deck");
    expect(get).toHaveBeenCalledWith("/presentations/deck/host/qna", { params: undefined });
    await listHostQuestions("deck", "pending");
    expect(get).toHaveBeenLastCalledWith("/presentations/deck/host/qna", { params: { status: "pending" } });

    await updateHostQuestion("deck", "q1", { status: "visible", pinned: true });
    expect(patch).toHaveBeenCalledWith("/presentations/deck/host/qna/q1", { status: "visible", pinned: true });
    await highlightHostQuestion("deck", "q1", true);
    expect(post).toHaveBeenCalledWith("/presentations/deck/host/qna/q1/highlight", { highlighted: true });
  });
});

describe("loadQna", () => {
  test("a participant loads its list into the slice, once for concurrent callers", async () => {
    const get = spyOn(apiClient, "get").mockResolvedValue(
      ok({ sessionId: "s1", qna: settings, reactions: { enabled: true, emojis: ["👍"] }, highlightedId: null, questions: [] })
    );
    const store = createLiveStore("participant", { presentationId: "deck", self: { participantId: "p1", name: "Ada", token: "t".repeat(32) } });
    const [a, b] = await Promise.all([loadQna(store), loadQna(store)]);
    expect(a && b).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    const qna = store.getState().modules.qna as QnaState;
    expect(qna.loaded).toBe(true);
    expect(qna.reactions?.emojis).toEqual(["👍"]);
  });

  test("a host loads the host list", async () => {
    const get = spyOn(apiClient, "get").mockResolvedValue(ok({ sessionId: null, qna: { ...settings, open: false }, highlightedId: null, questions: [] }));
    const store = createLiveStore("host", { presentationId: "deck" });
    expect(await loadQna(store)).toBe(true);
    expect(get).toHaveBeenCalledWith("/presentations/deck/host/qna", { params: undefined });
    expect((store.getState().modules.qna as QnaState).loaded).toBe(true);
  });

  test("a failed load reports false and leaves the slice unloaded; the next call tries again", async () => {
    const get = spyOn(apiClient, "get").mockRejectedValueOnce(new Error("offline"));
    const store = createLiveStore("host", { presentationId: "deck" });
    expect(await loadQna(store)).toBe(false);
    expect((store.getState().modules.qna as QnaState).loaded).toBe(false);
    get.mockResolvedValueOnce(ok({ sessionId: null, qna: settings, highlightedId: null, questions: [] }));
    expect(await loadQna(store)).toBe(true);
  });

  test("nothing loads before the surface knows the deck or the participant", async () => {
    const get = spyOn(apiClient, "get").mockResolvedValue(ok({}));
    expect(await loadQna(createLiveStore("host"))).toBe(false);
    expect(await loadQna(createLiveStore("participant", { presentationId: "deck" }))).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});
