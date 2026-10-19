import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { AxiosError, type AxiosResponse } from "axios";
import { renderToStaticMarkup } from "react-dom/server";

import { apiClient } from "@/lib/api-client";
import { isRetryableAnswerFailure } from "@/features/presentations/live/errors";
import { createLiveStore, participantLostReason } from "@/features/presentations/live/store";
import { getSlotEntries, registerSlot, SLOT_NAMES, SlotOutlet } from "@/features/presentations/live/slots";
import { PID, SELF, SID, SLIDE_IDS, T0, at, deck, event, hostState, liveSlide, liveState, sessionView } from "./live.fixtures";

/** A failed API call as axios reports it: `{ success: false, message, code }` with an HTTP status. */
const apiFailure = (status: number, code?: string, message = "nope") =>
  new AxiosError("failed", undefined, undefined, undefined, {
    status,
    data: { success: false, message, ...(code ? { code } : {}) },
  } as AxiosResponse);

/** What a successful `POST /answer` resolves to. */
const accepted = (data: Record<string, unknown> = {}) => ({
  data: {
    data: {
      accepted: true,
      replay: false,
      slideId: SLIDE_IDS[0],
      slideIndex: 0,
      clientAnswerId: "x",
      via: "rest",
      answeredAt: at(5),
      ...data,
    },
  },
});

// Retries wait for real; keep them short.
const participantStore = (init = {}) =>
  createLiveStore(
    "participant",
    {
      presentationId: PID,
      sessionId: SID,
      slideId: SLIDE_IDS[0],
      self: SELF,
      slide: liveSlide(),
      status: "active",
      ...init,
    },
    { answerRetryDelaysMs: [1, 1] }
  );

describe("createLiveStore", () => {
  test("each store is independent and changes only through dispatch", () => {
    const a = createLiveStore("host");
    const b = createLiveStore("participant", { presentationId: "p" });
    a.getState().dispatch({ type: "live/connection", connected: true });
    expect(a.getState().connected).toBe(true);
    expect(b.getState().connected).toBe(false);
    expect(b.getState().role).toBe("participant");
    expect(b.getState().presentationId).toBe("p");
  });

  test("dispatch keeps the actions on the store", () => {
    const store = createLiveStore("participant");
    store.getState().dispatch({ type: "live/reset", role: "participant" });
    expect(typeof store.getState().dispatch).toBe("function");
    expect(typeof store.getState().submitAnswer).toBe("function");
  });

  test("submitAnswer without a joined participant on a slide is skipped (no request)", async () => {
    const store = createLiveStore("participant", { presentationId: "p" });
    expect(await store.getState().submitAnswer({ optionIndex: 0 })).toEqual({ status: "skipped" });
  });

  test("submitAnswer posts a multi-select answer as the generic payload", async () => {
    const post = spyOn(apiClient, "post").mockResolvedValue(accepted());
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = createLiveStore("participant", {
        presentationId: "p",
        sessionId: "s1",
        slideId: "sl2",
        self: { participantId: "u1", name: "Ada", token: "t".repeat(16) },
        slide: {
          slideIndex: 2,
          totalSlides: 3,
          type: "select_answer",
          scored: true,
          question: "Which are planets?",
          options: [{ text: "Mars" }, { text: "Moon" }, { text: "Earth" }],
          allowMultiple: true,
          statements: [],
          minLabel: "",
          maxLabel: "",
          scaleMax: 5,
          items: [],
          maxEntries: 3,
          timeLimit: 30,
          points: 1000,
          scoreDependsOnTime: true,
        },
      });
      const result = await store.getState().submitAnswer({ payload: { optionIndices: [0, 2] } });
      expect(result).toMatchObject({ status: "accepted", replay: false });
      expect(post).toHaveBeenCalledWith("/presentations/p/answer", {
        participantId: "u1",
        participantToken: "t".repeat(16),
        slideIndex: 2,
        sessionId: "s1",
        slideId: "sl2",
        clientAnswerId: (result as { clientAnswerId: string }).clientAnswerId,
        payload: { optionIndices: [0, 2] },
      });
      expect(store.getState().submittedSlideIndex).toBe(2);
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });
});

describe("participant API failures", () => {
  test("participantLostReason maps the codes and statuses that mean 'your identity is gone'", () => {
    expect(participantLostReason(apiFailure(403, "PARTICIPANT_KICKED"))).toBe("kicked");
    expect(participantLostReason(apiFailure(409, "PARTICIPANT_STALE"))).toBe("stale");
    expect(participantLostReason(apiFailure(404))).toBe("missing");
    expect(participantLostReason(apiFailure(401))).toBe("missing");
    expect(participantLostReason(apiFailure(500))).toBeNull();
    expect(participantLostReason(apiFailure(403, "FORBIDDEN"))).toBeNull();
    expect(participantLostReason(new Error("offline"))).toBeNull();
  });

  test("an answer from an ended session's participant flags the credentials stale", async () => {
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(409, "PARTICIPANT_STALE", "Session ended"));
    try {
      const store = participantStore();
      expect(await store.getState().submitAnswer({ optionIndex: 0 })).toEqual({ status: "error", message: "Session ended", code: "PARTICIPANT_STALE" });
      expect(store.getState().lost).toBe("stale");
      expect(store.getState().self).toEqual(SELF);
      expect(store.getState().submittedSlideIndex).toBeNull();
    } finally {
      post.mockRestore();
    }
  });

  test("an answer from a removed participant forgets the identity", async () => {
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(403, "PARTICIPANT_KICKED"));
    try {
      const store = participantStore();
      const result = await store.getState().submitAnswer({ optionIndex: 0 });
      expect(result).toMatchObject({ status: "error", code: "PARTICIPANT_KICKED" });
      expect(store.getState()).toMatchObject({ lost: "kicked", self: null });
    } finally {
      post.mockRestore();
    }
  });

  test("ALREADY_ANSWERED counts as submitted; so does a bare 409", async () => {
    for (const failure of [apiFailure(409, "ALREADY_ANSWERED"), apiFailure(409)]) {
      const post = spyOn(apiClient, "post").mockRejectedValue(failure);
      const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
      try {
        const store = participantStore();
        expect(await store.getState().submitAnswer({ optionIndex: 0 })).toEqual({ status: "duplicate" });
        expect(store.getState().submittedSlideIndex).toBe(0);
      } finally {
        post.mockRestore();
        get.mockRestore();
      }
    }
  });

  test("a duplicate answer (409 without a live code) counts as submitted", async () => {
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(409));
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participantStore();
      expect(await store.getState().submitAnswer({ optionIndex: 0 })).toEqual({ status: "duplicate" });
      expect(store.getState().submittedSlideIndex).toBe(0);
      expect(store.getState().lost).toBeNull();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("another failure is reported with the API's message and changes nothing", async () => {
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(400, undefined, "Answer window closed"));
    try {
      const store = participantStore();
      expect(await store.getState().submitAnswer({ optionIndex: 0 })).toEqual({ status: "error", message: "Answer window closed", code: undefined });
      expect(store.getState().lost).toBeNull();
    } finally {
      post.mockRestore();
    }
  });

  test("loadLiveState resyncs from GET /live-state with a fresh clock sample", async () => {
    const get = spyOn(apiClient, "get").mockResolvedValue({ data: { data: liveState({ serverNow: at(10) }) } });
    const now = spyOn(Date, "now").mockReturnValue(T0 + 8000);
    try {
      const store = participantStore({ status: "lobby", slide: null, slideId: null });
      expect(await store.getState().loadLiveState()).toBe(true);
      expect(get).toHaveBeenCalledWith(`/presentations/${PID}/live-state`, { params: { participantId: "p1", token: SELF.token } });
      expect(store.getState()).toMatchObject({ status: "active", phase: "open", slideId: SLIDE_IDS[0], clockOffsetMs: 2000 });
    } finally {
      get.mockRestore();
      now.mockRestore();
    }
  });

  test("loadLiveState reports a vanished participant, a stale session and a removal", async () => {
    for (const [failure, reason] of [
      [apiFailure(404), "missing"],
      [apiFailure(409, "PARTICIPANT_STALE"), "stale"],
      [apiFailure(403, "PARTICIPANT_KICKED"), "kicked"],
    ] as const) {
      const get = spyOn(apiClient, "get").mockRejectedValue(failure);
      try {
        const store = participantStore();
        expect(await store.getState().loadLiveState()).toBe(false);
        expect(store.getState().lost).toBe(reason);
      } finally {
        get.mockRestore();
      }
    }
  });

  test("loadLiveState keeps the screen on a network error", async () => {
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participantStore();
      expect(await store.getState().loadLiveState()).toBe(false);
      expect(store.getState().lost).toBeNull();
      expect(store.getState().self).toEqual(SELF);
    } finally {
      get.mockRestore();
    }
  });

  test("loadLiveState without an identity does nothing", async () => {
    const store = participantStore({ self: null });
    expect(await store.getState().loadLiveState()).toBe(false);
  });

  test("loadMe flags a vanished participant and ignores other failures", async () => {
    const get = spyOn(apiClient, "get");
    try {
      get.mockRejectedValue(apiFailure(500));
      const kept = participantStore();
      await kept.getState().loadMe();
      expect(kept.getState().lost).toBeNull();

      get.mockRejectedValue(apiFailure(404));
      const gone = participantStore();
      await gone.getState().loadMe();
      expect(gone.getState().lost).toBe("missing");
    } finally {
      get.mockRestore();
    }
  });
});

describe("answer path", () => {
  const sentBodies = (post: { mock: { calls: unknown[][] } }) =>
    post.mock.calls.map((call: unknown[]) => call[1] as Record<string, unknown>);

  test("each attempt carries a fresh clientAnswerId and the slide ticket", async () => {
    const post = spyOn(apiClient, "post").mockResolvedValue(accepted());
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participantStore({ slideTicket: "st1.ticket-open" });
      const first = await store.getState().submitAnswer({ optionIndex: 0 });
      const second = await store.getState().submitAnswer({ optionIndex: 1 });
      const [one, two] = sentBodies(post);
      expect(one).toMatchObject({ slideTicket: "st1.ticket-open", sessionId: SID, slideId: SLIDE_IDS[0], optionIndex: 0 });
      expect(typeof one.clientAnswerId).toBe("string");
      expect((one.clientAnswerId as string).length).toBeLessThanOrEqual(64);
      expect(one.clientAnswerId).not.toBe(two.clientAnswerId);
      expect(first).toMatchObject({ status: "accepted", clientAnswerId: one.clientAnswerId });
      expect(second).toMatchObject({ status: "accepted", clientAnswerId: two.clientAnswerId });
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("without a ticket (late join before live-state) none is sent", async () => {
    const post = spyOn(apiClient, "post").mockResolvedValue(accepted());
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      await participantStore().getState().submitAnswer({ optionIndex: 0 });
      expect("slideTicket" in sentBodies(post)[0]).toBe(false);
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("a transient failure is re-sent with the same clientAnswerId, and a replay counts once", async () => {
    const post = spyOn(apiClient, "post")
      .mockRejectedValueOnce(new AxiosError("Network Error"))
      .mockRejectedValueOnce(apiFailure(503))
      .mockResolvedValue(accepted({ replay: true }));
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participantStore();
      const result = await store.getState().submitAnswer({ optionIndex: 0 });
      expect(result).toMatchObject({ status: "accepted", replay: true });
      const bodies = sentBodies(post);
      expect(bodies).toHaveLength(3);
      expect(new Set(bodies.map((body: Record<string, unknown>) => body.clientAnswerId)).size).toBe(1);
      expect(store.getState().submittedSlideIndex).toBe(0);
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("the per-participant rate limit (429 RATE_LIMITED) is retried, then reported", async () => {
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(429, "RATE_LIMITED", "Slow down"));
    try {
      const store = participantStore();
      expect(await store.getState().submitAnswer({ optionIndex: 0 })).toEqual({ status: "error", message: "Slow down", code: "RATE_LIMITED" });
      expect(post).toHaveBeenCalledTimes(3);
      expect(store.getState().submittedSlideIndex).toBeNull();
    } finally {
      post.mockRestore();
    }
  });

  test("final answers from the server are not retried", async () => {
    for (const [failure, code] of [
      [apiFailure(400, "NOT_ACCEPTING"), "NOT_ACCEPTING"],
      [apiFailure(400, "TIME_UP"), "TIME_UP"],
      [apiFailure(400, undefined, "payload.optionIndex: Required"), undefined],
    ] as const) {
      const post = spyOn(apiClient, "post").mockRejectedValue(failure);
      const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
      try {
        const store = participantStore();
        expect(await store.getState().submitAnswer({ optionIndex: 0 })).toMatchObject({ status: "error", code });
        expect(post).toHaveBeenCalledTimes(1);
        expect(store.getState().submittedSlideIndex).toBeNull();
      } finally {
        post.mockRestore();
        get.mockRestore();
      }
    }
  });

  test("NOT_ACCEPTING and TIME_UP make the phone re-read the live state", async () => {
    for (const code of ["NOT_ACCEPTING", "TIME_UP"]) {
      const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(400, code));
      const get = spyOn(apiClient, "get").mockResolvedValue({ data: { data: liveState({}, { phase: "closed", slideTicket: null }) } });
      try {
        const store = participantStore({ slideTicket: "st1.ticket-open", phase: "open" });
        await store.getState().submitAnswer({ optionIndex: 0 });
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(get).toHaveBeenCalledWith(`/presentations/${PID}/live-state`, expect.anything());
        expect(store.getState()).toMatchObject({ phase: "closed", slideTicket: null });
      } finally {
        post.mockRestore();
        get.mockRestore();
      }
    }
  });

  test("isRetryableAnswerFailure: network, 5xx and 429 only", () => {
    expect(isRetryableAnswerFailure(new AxiosError("Network Error"))).toBe(true);
    expect(isRetryableAnswerFailure(apiFailure(500))).toBe(true);
    expect(isRetryableAnswerFailure(apiFailure(429, "RATE_LIMITED"))).toBe(true);
    for (const status of [400, 401, 403, 404, 409]) expect(isRetryableAnswerFailure(apiFailure(status))).toBe(false);
    expect(isRetryableAnswerFailure(new Error("bug"))).toBe(false);
  });
});

describe("resync", () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  test("events that arrive while the snapshot loads are replayed on top of it", async () => {
    const store = participantStore({ status: "lobby", slide: null, slideId: null });
    const gate = deferred<void>();
    const pending = store.getState().resync(async () => {
      await gate.promise;
      return { type: "participant/live-state", state: liveState({ status: "active" }, { phase: "open" }), receivedAt: T0 + 10_000 } as const;
    });
    // The host closes voting while the read is in flight.
    store.getState().dispatch(
      event("slide:closed", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), closedAt: at(12), answeredCount: 1, participantCount: 2, isLastSlide: false, revisit: false, serverNow: at(12) })
    );
    expect(store.getState().phase).toBe("closed");
    gate.resolve();
    expect(await pending).toBe(true);
    // The snapshot said "open"; the replayed event wins because it is newer.
    expect(store.getState()).toMatchObject({ status: "active", phase: "closed", slideId: SLIDE_IDS[0] });
  });

  test("a host command answered while an older host-state read is in flight is not overwritten by it", async () => {
    const store = createLiveStore("host", { presentationId: PID });
    const loaded = (session: ReturnType<typeof sessionView>) => ({ type: "host/state-loaded", state: hostState(session), receivedAt: T0 } as const);
    store.getState().dispatch(loaded(sessionView()));
    const gate = deferred<void>();
    // The read was issued while slide 1 was current…
    const pending = store.getState().resync(async () => {
      await gate.promise;
      return loaded(sessionView());
    });
    // …then the host moved to slide 2 and its command answered first.
    store.getState().dispatch({
      type: "host/command",
      response: { ...deck({ status: "active" }), session: sessionView({ currentSlideId: SLIDE_IDS[1], currentSlideIndex: 1 }, { slideId: SLIDE_IDS[1], slideIndex: 1, type: "heading", lifecycle: "content", scored: false, phase: "shown", endsAt: null }) },
    });
    gate.resolve();
    await pending;
    expect(store.getState()).toMatchObject({ currentSlideIndex: 1, slideId: SLIDE_IDS[1], phase: "shown" });
  });

  test("overlapping resyncs: only the latest applies", async () => {
    const store = participantStore();
    const first = deferred<void>();
    const older = store.getState().resync(async () => {
      await first.promise;
      return { type: "participant/live-state", state: liveState({ title: "older" }), receivedAt: T0 } as const;
    });
    const newer = await store.getState().resync(async () => ({ type: "participant/live-state", state: liveState({ title: "newer" }), receivedAt: T0 }) as const);
    expect(newer).toBe(true);
    first.resolve();
    expect(await older).toBe(false);
    expect(store.getState().title).toBe("newer");
  });

  test("a load that returns no action skips the apply; a failing one rejects", async () => {
    const store = participantStore();
    expect(await store.getState().resync(async () => null)).toBe(false);
    await expect(store.getState().resync(async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    // The failed request does not leave a recorder behind: later events still apply once.
    store.getState().dispatch(event("participant:joined", { participantId: "p9", name: "Zed", participantCount: 9 }));
    expect(store.getState().participants).toHaveLength(1);
  });
});

describe("live slots", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
  const props = { presentationId: "p", participantId: "x" };

  test("the slot list is the documented one", () => {
    expect([...SLOT_NAMES]).toEqual([
      "participantTabs",
      "participantFooter",
      "participantBanner",
      "participantBody",
      "endScreen",
      "stageOverlays",
      "presenterPanels",
      "hostToolbar",
    ]);
  });

  test("an empty slot renders nothing at all", () => {
    expect(renderToStaticMarkup(<SlotOutlet name="participantFooter" props={props} />)).toBe("");
  });

  test("entries render in order, without wrapper markup, with the slot props", () => {
    cleanups.push(
      registerSlot("participantFooter", { id: "b", order: 20, Component: ({ participantId }) => <i>b:{participantId}</i> }),
      registerSlot("participantFooter", { id: "a", order: 10, Component: () => <i>a</i> }),
      registerSlot("participantFooter", { id: "c", Component: () => <i>c</i> })
    );
    expect(renderToStaticMarkup(<SlotOutlet name="participantFooter" props={props} />)).toBe("<i>a</i><i>b:x</i><i>c</i>");
  });

  test("`when` filters entries per render", () => {
    cleanups.push(
      registerSlot("participantBanner", { id: "only-x", when: (p) => p.participantId === "x", Component: () => <b>x</b> })
    );
    expect(getSlotEntries("participantBanner", props).map((e) => e.id)).toEqual(["only-x"]);
    expect(getSlotEntries("participantBanner", { ...props, participantId: "y" })).toEqual([]);
    expect(getSlotEntries("participantBanner").map((e) => e.id)).toEqual(["only-x"]);
  });

  test("registering an id again replaces the entry; unregister removes it", () => {
    const first = registerSlot("hostToolbar", { id: "remote", label: "v1", Component: () => null });
    const second = registerSlot("hostToolbar", { id: "remote", label: "v2", Component: () => null });
    expect(getSlotEntries("hostToolbar").map((e) => e.label)).toEqual(["v2"]);
    first(); // stale unregister: no-op
    expect(getSlotEntries("hostToolbar")).toHaveLength(1);
    second();
    expect(getSlotEntries("hostToolbar")).toHaveLength(0);
  });
});
