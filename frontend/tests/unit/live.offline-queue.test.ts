import { describe, expect, spyOn, test } from "bun:test";
import { AxiosError, type AxiosResponse } from "axios";
import type { Socket } from "socket.io-client";

import { apiClient } from "@/lib/api-client";
import {
  ANSWER_ACK_TIMEOUT_MS,
  createSocketAnswerTransport,
  deliverAnswer,
  type AnswerSocketTransport,
} from "@/features/presentations/live/answerDelivery";
import { answerFailureVerdict } from "@/features/presentations/live/errors";
import {
  createAnswerSync,
  createMemoryAnswerStorage,
  queueRetryDelayMs,
  QUEUE_MAX_AGE_MS,
  withMemoryFallback,
  type AnswerQueueStorage,
  type QueuedAnswer,
} from "@/features/presentations/live/offline";
import { createInitialLiveState, liveReducer, pendingAnswerKey, type LiveState } from "@/features/presentations/live/reducer";
import { createLiveStore } from "@/features/presentations/live/store";
import type { AnswerRequest, AnswerResult, AnswerSubmitAck } from "@/features/presentations/types";
import { PID, SELF, SID, SID2, SLIDE_IDS, at, event, liveSlide, liveState, run } from "./live.fixtures";

// ---------- helpers ----------

const apiFailure = (status: number, code?: string, message = "nope") =>
  new AxiosError("failed", undefined, undefined, undefined, {
    status,
    data: { success: false, message, ...(code ? { code } : {}) },
  } as AxiosResponse);

const result = (overrides: Partial<AnswerResult> = {}): AnswerResult => ({
  accepted: true,
  replay: false,
  slideId: SLIDE_IDS[0],
  slideIndex: 0,
  clientAnswerId: "a".repeat(32),
  via: "rest",
  answeredAt: at(5),
  ...overrides,
});

const okAck = (overrides: Partial<AnswerResult> = {}): AnswerSubmitAck => ({
  success: true,
  status: 200,
  message: "Answer accepted",
  data: result({ via: "socket", ...overrides }),
});

const failAck = (status: number, code?: string, message = "nope"): AnswerSubmitAck => ({
  success: false,
  status,
  message,
  ...(code ? { code } : {}),
  data: null,
});

const body = (overrides: Partial<AnswerRequest> = {}): AnswerRequest => ({
  participantId: SELF.participantId,
  participantToken: SELF.token,
  slideIndex: 0,
  sessionId: SID,
  slideId: SLIDE_IDS[0],
  clientAnswerId: "a".repeat(32),
  optionIndex: 1,
  ...overrides,
});

const queued = (overrides: Partial<QueuedAnswer> = {}): QueuedAnswer => {
  const clientAnswerId = overrides.clientAnswerId ?? "a".repeat(32);
  return {
    clientAnswerId,
    presentationId: PID,
    sessionId: SID,
    participantId: SELF.participantId,
    slideId: SLIDE_IDS[0],
    slideIndex: 0,
    body: body({ clientAnswerId }),
    queuedAt: 1_000,
    attempts: 0,
    nextAttemptAt: 2_000,
    ...overrides,
  };
};

const transportOf = (submit: AnswerSocketTransport["submit"]) => {
  const calls: AnswerRequest[] = [];
  const transport: AnswerSocketTransport = {
    submit: (b) => {
      calls.push(b);
      return submit(b);
    },
  };
  return { transport, calls };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- backoff, verdicts ----------

describe("queue backoff", () => {
  test("grows 1 s, 2 s, 4 s, 8 s, 15 s, then stays at 30 s", () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 7, 40].map((n) => queueRetryDelayMs(n, undefined, mid))).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000,
    ]);
  });

  test("jitters each step by ±20%", () => {
    expect(queueRetryDelayMs(3, undefined, () => 0)).toBe(3_200);
    expect(queueRetryDelayMs(3, undefined, () => 1)).toBe(4_800);
    expect(queueRetryDelayMs(1, [10, 20], () => 0.5)).toBe(10);
    expect(queueRetryDelayMs(0, [10, 20], () => 0.5)).toBe(10);
  });
});

describe("answerFailureVerdict (the server's client rule)", () => {
  test("no response, 5xx and 429 retry; NOT_JOINED rejoins; the rest is final", () => {
    expect(answerFailureVerdict(undefined)).toBe("retry");
    expect(answerFailureVerdict(500)).toBe("retry");
    expect(answerFailureVerdict(503)).toBe("retry");
    expect(answerFailureVerdict(429, "RATE_LIMITED")).toBe("retry");
    expect(answerFailureVerdict(403, "NOT_JOINED")).toBe("rejoin");
    for (const [status, code] of [
      [400, "NOT_ACCEPTING"],
      [400, "TIME_UP"],
      [400, undefined],
      [401, undefined],
      [403, "PARTICIPANT_KICKED"],
      [409, "ALREADY_ANSWERED"],
      [409, "PARTICIPANT_STALE"],
    ] as const) {
      expect(answerFailureVerdict(status, code)).toBe("final");
    }
  });
});

// ---------- storage ----------

describe("answer queue storage", () => {
  test("memory storage keeps entries per deck, by clientAnswerId, and hands out copies", async () => {
    const storage = createMemoryAnswerStorage();
    await storage.put(queued({ clientAnswerId: "one" }));
    await storage.put(queued({ clientAnswerId: "two" }));
    await storage.put(queued({ clientAnswerId: "other-deck", presentationId: "p2" }));
    await storage.put(queued({ clientAnswerId: "one", attempts: 3 }));
    const listed = await storage.list(PID);
    expect(listed.map((e) => [e.clientAnswerId, e.attempts]).sort()).toEqual([
      ["one", 3],
      ["two", 0],
    ]);
    listed[0].attempts = 99;
    expect((await storage.list(PID)).some((e) => e.attempts === 99)).toBe(false);
    await storage.remove("one");
    expect((await storage.list(PID)).map((e) => e.clientAnswerId)).toEqual(["two"]);
    expect((await storage.list("p2")).map((e) => e.clientAnswerId)).toEqual(["other-deck"]);
  });

  test("withMemoryFallback keeps what the primary store cannot hold (private mode, quota)", async () => {
    const failing: AnswerQueueStorage = {
      put: async () => {
        throw new Error("QuotaExceededError");
      },
      remove: async () => {
        throw new Error("broken");
      },
      list: async () => {
        throw new Error("broken");
      },
    };
    const storage = withMemoryFallback(failing);
    await storage.put(queued());
    expect((await storage.list(PID)).map((e) => e.clientAnswerId)).toEqual(["a".repeat(32)]);
    await storage.remove("a".repeat(32));
    expect(await storage.list(PID)).toEqual([]);
  });

  test("withMemoryFallback stores in the primary when it works, without a second copy", async () => {
    const primary = createMemoryAnswerStorage();
    const storage = withMemoryFallback(primary);
    await storage.put(queued());
    expect(await primary.list(PID)).toHaveLength(1);
    expect(await storage.list(PID)).toHaveLength(1);
  });
});

// ---------- socket transport ----------

describe("socket answer transport", () => {
  const fakeSocket = (connected: boolean, reply: unknown) => {
    const emitted: Array<{ timeout: number; event: string; payload: unknown }> = [];
    const socket = {
      connected,
      timeout: (ms: number) => ({
        emitWithAck: async (eventName: string, payload: unknown) => {
          emitted.push({ timeout: ms, event: eventName, payload });
          return reply;
        },
      }),
    } as unknown as Socket;
    return { socket, emitted };
  };

  test("sends answer:submit with the deck and a 3 s ack timeout", async () => {
    const { socket, emitted } = fakeSocket(true, okAck());
    const ack = await createSocketAnswerTransport(socket, PID).submit(body());
    expect(ack).toEqual(okAck());
    expect(ANSWER_ACK_TIMEOUT_MS).toBe(3_000);
    expect(emitted).toEqual([{ timeout: 3_000, event: "answer:submit", payload: { ...body(), presentationId: PID } }]);
  });

  test("a disconnected socket rejects at once and emits nothing (no buffered packet before the rejoin)", async () => {
    const { socket, emitted } = fakeSocket(false, okAck());
    await expect(createSocketAnswerTransport(socket, PID).submit(body())).rejects.toThrow("socket disconnected");
    expect(emitted).toEqual([]);
  });
});

// ---------- delivery ----------

describe("deliverAnswer: socket ack → REST", () => {
  const options = (overrides: Partial<Parameters<typeof deliverAnswer>[2]> = {}) => ({
    transport: null,
    restRetryDelaysMs: [1, 1],
    isOnline: () => true,
    post: async () => result(),
    wait: async () => {},
    ...overrides,
  });

  test("offline: nothing is sent", async () => {
    let posts = 0;
    const { transport, calls } = transportOf(async () => okAck());
    const outcome = await deliverAnswer(PID, body(), options({ transport, isOnline: () => false, post: async () => (posts++, result()) }));
    expect(outcome).toEqual({ kind: "unreachable" });
    expect(calls).toHaveLength(0);
    expect(posts).toBe(0);
  });

  test("an ack from the joined socket settles it; REST is not used", async () => {
    let posts = 0;
    const { transport, calls } = transportOf(async () => okAck({ replay: true }));
    const outcome = await deliverAnswer(PID, body(), options({ transport, post: async () => (posts++, result()) }));
    expect(outcome).toMatchObject({ kind: "accepted", channel: "socket", result: { replay: true } });
    expect(calls).toEqual([body()]);
    expect(posts).toBe(0);
  });

  test("no ack in time, NOT_JOINED, 429 and 5xx fall back to REST with the same clientAnswerId", async () => {
    for (const submit of [
      async () => Promise.reject(new Error("operation has timed out")),
      async () => failAck(403, "NOT_JOINED"),
      async () => failAck(429, "RATE_LIMITED"),
      async () => failAck(503),
    ]) {
      const sent: AnswerRequest[] = [];
      const { transport } = transportOf(submit);
      const outcome = await deliverAnswer(PID, body(), options({ transport, post: async (_pid, b) => (sent.push(b), result()) }));
      expect(outcome).toMatchObject({ kind: "accepted", channel: "rest" });
      expect(sent.map((b) => b.clientAnswerId)).toEqual(["a".repeat(32)]);
    }
  });

  test("a final socket ack (TIME_UP, ALREADY_ANSWERED, kicked) is the answer; REST is not tried", async () => {
    for (const ack of [failAck(400, "TIME_UP", "Time is up"), failAck(409, "ALREADY_ANSWERED"), failAck(403, "PARTICIPANT_KICKED")]) {
      let posts = 0;
      const { transport } = transportOf(async () => ack);
      const outcome = await deliverAnswer(PID, body(), options({ transport, post: async () => (posts++, result()) }));
      expect(outcome).toEqual({ kind: "refused", status: ack.status, code: (ack as { code?: string }).code, message: ack.message });
      expect(posts).toBe(0);
    }
  });

  test("REST re-sends transient failures, then gives up as unreachable", async () => {
    const failures = [new AxiosError("Network Error"), apiFailure(503)];
    let calls = 0;
    const flaky = async () => {
      const failure = failures[calls++];
      if (failure) throw failure;
      return result({ replay: true });
    };
    expect(await deliverAnswer(PID, body(), options({ post: flaky }))).toMatchObject({ kind: "accepted", channel: "rest", result: { replay: true } });
    expect(calls).toBe(3);

    let down = 0;
    const outcome = await deliverAnswer(PID, body(), options({ post: async () => { down++; throw new AxiosError("Network Error", "ERR_NETWORK"); } }));
    expect(outcome).toEqual({ kind: "unreachable" });
    expect(down).toBe(3);
  });

  test("a REST request that ran into its timeout is not re-sent: the answer goes to the queue", async () => {
    for (const code of ["ECONNABORTED", "ETIMEDOUT"]) {
      let calls = 0;
      const outcome = await deliverAnswer(
        PID,
        body(),
        options({
          post: async () => {
            calls++;
            throw new AxiosError("timeout of 10000ms exceeded", code);
          },
        })
      );
      expect(outcome).toEqual({ kind: "unreachable" });
      expect(calls).toBe(1);
    }
  });

  test("REST stops re-sending as soon as the device reports itself offline", async () => {
    let online = true;
    let calls = 0;
    const outcome = await deliverAnswer(
      PID,
      body(),
      options({
        isOnline: () => online,
        post: async () => {
          calls++;
          online = false;
          throw new AxiosError("Network Error");
        },
      })
    );
    expect(outcome).toEqual({ kind: "unreachable" });
    expect(calls).toBe(1);
  });

  test("a final REST error is refused with the server's status, code and message", async () => {
    const outcome = await deliverAnswer(PID, body(), options({ post: async () => Promise.reject(apiFailure(400, "NOT_ACCEPTING", "Closed")) }));
    expect(outcome).toEqual({ kind: "refused", status: 400, code: "NOT_ACCEPTING", message: "Closed" });
  });
});

// ---------- the sender ----------

describe("createAnswerSync", () => {
  const setup = (send: (entry: QueuedAnswer) => Promise<import("@/features/presentations/live/answerDelivery").AnswerDelivery>, extra: Partial<Parameters<typeof createAnswerSync>[0]> = {}) => {
    const storage = createMemoryAnswerStorage();
    let clock = 10_000;
    const sent: QueuedAnswer[] = [];
    const pending: string[] = [];
    const settled: Array<[string, string]> = [];
    const sync = createAnswerSync({
      storage,
      presentationId: () => PID,
      send: async (entry) => {
        sent.push(entry);
        return send(entry);
      },
      onPending: (entry) => pending.push(entry.clientAnswerId),
      onSettled: (entry, outcome) => settled.push([entry.clientAnswerId, outcome.kind]),
      now: () => clock,
      random: () => 0.5,
      retryDelaysMs: [1_000, 2_000],
      ...extra,
    });
    return {
      storage,
      sync,
      sent,
      pending,
      settled,
      advance: (ms: number) => (clock += ms),
      now: () => clock,
    };
  };

  test("stopped: enqueue stores the answer and sends nothing", async () => {
    const { storage, sync, sent } = setup(async () => ({ kind: "accepted", result: result(), channel: "rest" }));
    await sync.enqueue(queued({ queuedAt: 9_000 }));
    await sync.flush(true);
    expect(sent).toHaveLength(0);
    expect(await storage.list(PID)).toHaveLength(1);
  });

  test("start sends every queued answer of the deck, due or not, and removes the accepted ones", async () => {
    const { storage, sync, sent, settled, pending } = setup(async () => ({ kind: "accepted", result: result(), channel: "rest" }));
    await storage.put(queued({ clientAnswerId: "due", queuedAt: 9_000, nextAttemptAt: 9_500 }));
    await storage.put(queued({ clientAnswerId: "later", queuedAt: 9_100, nextAttemptAt: 60_000 }));
    await storage.put(queued({ clientAnswerId: "other-deck", presentationId: "p2", queuedAt: 9_000 }));
    sync.start();
    await sync.flush();
    expect(sent.map((e) => e.clientAnswerId)).toEqual(["due", "later"]);
    expect(pending).toEqual(["due", "later"]);
    expect(settled).toEqual([
      ["due", "accepted"],
      ["later", "accepted"],
    ]);
    expect(await storage.list(PID)).toEqual([]);
    expect(await storage.list("p2")).toHaveLength(1);
    sync.stop();
  });

  test("an unreachable send stays queued with one more attempt and the next backoff step", async () => {
    let up = false;
    const { storage, sync, sent, settled, advance, now } = setup(async () =>
      up ? { kind: "accepted", result: result(), channel: "rest" } : { kind: "unreachable" }
    );
    await storage.put(queued({ queuedAt: 9_000, nextAttemptAt: 9_000 }));
    sync.start();
    await sync.flush();
    let [entry] = await storage.list(PID);
    expect(entry).toMatchObject({ attempts: 1, nextAttemptAt: now() + 1_000 });

    // Not due yet: a plain flush leaves it alone.
    await sync.flush(false);
    expect(sent).toHaveLength(1);
    advance(1_000);
    await sync.flush(false);
    [entry] = await storage.list(PID);
    expect(entry).toMatchObject({ attempts: 2, nextAttemptAt: now() + 2_000 });
    expect(sent).toHaveLength(2);

    // A reconnect (forced flush) does not wait for the backoff.
    up = true;
    await sync.flush(true);
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((e) => e.clientAnswerId)).size).toBe(1);
    expect(settled).toEqual([["a".repeat(32), "accepted"]]);
    expect(await storage.list(PID)).toEqual([]);
    sync.stop();
  });

  test("a refused answer leaves the queue and is reported", async () => {
    const { storage, sync, settled } = setup(async () => ({ kind: "refused", status: 400, code: "TIME_UP" }));
    await storage.put(queued({ queuedAt: 9_000 }));
    sync.start();
    await sync.flush();
    expect(settled).toEqual([["a".repeat(32), "refused"]]);
    expect(await storage.list(PID)).toEqual([]);
    sync.stop();
  });

  test("while the device is offline nothing is sent and no attempt is counted", async () => {
    let online = false;
    const { storage, sync, sent, pending } = setup(async () => ({ kind: "accepted", result: result(), channel: "rest" }), {
      isOnline: () => online,
    });
    await storage.put(queued({ queuedAt: 9_000 }));
    sync.start();
    await sync.flush(true);
    expect(sent).toHaveLength(0);
    expect(pending).toHaveLength(2); // still shown as saved
    expect((await storage.list(PID))[0].attempts).toBe(0);
    online = true;
    await sync.flush(true);
    expect(sent).toHaveLength(1);
    sync.stop();
  });

  test("answers older than a day are dropped unsent", async () => {
    const { storage, sync, sent, settled } = setup(async () => ({ kind: "accepted", result: result(), channel: "rest" }));
    await storage.put(queued({ queuedAt: 10_000 - QUEUE_MAX_AGE_MS - 1 }));
    sync.start();
    await sync.flush();
    expect(sent).toHaveLength(0);
    expect(settled).toHaveLength(0);
    expect(await storage.list(PID)).toEqual([]);
    sync.stop();
  });

  test("one pass at a time: flushes asked for during a send never send an answer twice at once", async () => {
    const gate = deferred<void>();
    let inFlight = 0;
    let maxInFlight = 0;
    const { storage, sync, sent } = setup(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate.promise;
      inFlight--;
      return { kind: "accepted", result: result(), channel: "rest" };
    });
    await storage.put(queued({ queuedAt: 9_000 }));
    sync.start();
    const flushes = [sync.flush(true), sync.flush(true), sync.flush(false)];
    await tick();
    gate.resolve();
    await Promise.all(flushes);
    expect(maxInFlight).toBe(1);
    expect(sent).toHaveLength(1);
    sync.stop();
  });

  test("retries on its own timer, and stop() cancels it", async () => {
    let calls = 0;
    const storage = createMemoryAnswerStorage();
    const settled: string[] = [];
    const sync = createAnswerSync({
      storage,
      presentationId: () => PID,
      send: async () => (++calls < 3 ? { kind: "unreachable" } : { kind: "accepted", result: result(), channel: "rest" }),
      onSettled: (entry) => settled.push(entry.clientAnswerId),
      retryDelaysMs: [5],
      random: () => 0.5,
    });
    await storage.put(queued({ queuedAt: Date.now() }));
    sync.start();
    for (let i = 0; i < 40 && settled.length === 0; i++) await tick(5);
    expect(calls).toBe(3);
    expect(settled).toEqual(["a".repeat(32)]);

    calls = 0;
    await storage.put(queued({ clientAnswerId: "b".repeat(32), queuedAt: Date.now() }));
    await sync.flush(true);
    expect(calls).toBe(1);
    sync.stop();
    await tick(40);
    expect(calls).toBe(1);
  });
});

// ---------- reducer ----------

describe("pending answers in the live state", () => {
  const onSlide = (extra: Partial<LiveState> = {}) =>
    createInitialLiveState("participant", {
      presentationId: PID,
      sessionId: SID,
      self: SELF,
      status: "active",
      currentSlideIndex: 0,
      slideId: SLIDE_IDS[0],
      phase: "open",
      slide: liveSlide(),
      ...extra,
    });
  const key = pendingAnswerKey(SLIDE_IDS[0], 0);
  const ref = { slideId: SLIDE_IDS[0], slideIndex: 0, clientAnswerId: "x1" };

  test("queued → synced: the saved state clears and the slide on screen counts as answered", () => {
    const queuedState = liveReducer(onSlide(), { type: "participant/answer-queued", ...ref });
    expect(queuedState.pendingAnswers[key]).toMatchObject({ status: "queued", clientAnswerId: "x1" });
    // Seen again (a reload, each flush pass): same state object.
    expect(liveReducer(queuedState, { type: "participant/answer-queued", ...ref })).toBe(queuedState);
    const synced = liveReducer(queuedState, { type: "participant/answer-synced", ...ref });
    expect(synced.pendingAnswers).toEqual({});
    expect(synced.submittedSlideIndex).toBe(0);
  });

  test("an answer synced after the phone moved on does not mark the new slide answered", () => {
    const state = onSlide({ currentSlideIndex: 1, slideId: SLIDE_IDS[1] });
    const synced = run(state, { type: "participant/answer-queued", ...ref }, { type: "participant/answer-synced", ...ref });
    expect(synced.pendingAnswers).toEqual({});
    expect(synced.submittedSlideIndex).toBeNull();
  });

  test("refused keeps the server's code; a reopen of that slide drops the refusal", () => {
    const refused = run(
      onSlide(),
      { type: "participant/answer-queued", ...ref },
      { type: "participant/answer-refused", ...ref, code: "NOT_ACCEPTING", message: "Closed" }
    );
    expect(refused.pendingAnswers[key]).toMatchObject({ status: "refused", code: "NOT_ACCEPTING", message: "Closed" });
    const reopened = run(
      refused,
      event("question:started", {
        slideId: SLIDE_IDS[0],
        slideIndex: 0,
        slide: liveSlide(),
        startedAt: at(40),
        endsAt: at(70),
        serverNow: at(40),
        isLastSlide: false,
        reopened: true,
        slideTicket: "st1.reopened",
      })
    );
    expect(reopened.pendingAnswers).toEqual({});
  });

  test("a refusal of an older attempt does not replace a newer queued one", () => {
    const state = liveReducer(onSlide(), { type: "participant/answer-queued", ...ref, clientAnswerId: "new" });
    expect(liveReducer(state, { type: "participant/answer-refused", ...ref, clientAnswerId: "old", code: "TIME_UP", message: null })).toBe(state);
  });

  test("another session clears the pending answers", () => {
    const state = liveReducer(onSlide(), { type: "participant/answer-queued", ...ref });
    const other = liveReducer(state, { type: "participant/live-state", state: liveState({ sessionId: SID2 }) });
    expect(other.pendingAnswers).toEqual({});
  });
});

// ---------- the store: submitAnswer → queue → sync ----------

describe("submitAnswer with the offline queue", () => {
  const participant = (storage: AnswerQueueStorage, online: { value: boolean }, init: Partial<LiveState> = {}) =>
    createLiveStore(
      "participant",
      {
        presentationId: PID,
        sessionId: SID,
        slideId: SLIDE_IDS[0],
        self: SELF,
        slide: liveSlide(),
        status: "active",
        currentSlideIndex: 0,
        phase: "open",
        slideTicket: "st1.ticket-open",
        ...init,
      },
      { answerRetryDelaysMs: [1, 1], answerQueue: storage, queueRetryDelaysMs: [60_000], isOnline: () => online.value }
    );

  const okPost = (data: Partial<AnswerResult> = {}) => ({ data: { data: result(data) } });

  test("offline: the answer is saved at once (nothing sent), then synced once with the same id when back online", async () => {
    const storage = createMemoryAnswerStorage();
    const online = { value: false };
    const post = spyOn(apiClient, "post").mockResolvedValue(okPost({ via: "offline" }));
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participant(storage, online);
      const stop = store.getState().startAnswerSync();
      const outcome = await store.getState().submitAnswer({ optionIndex: 1 });
      expect(outcome).toMatchObject({ status: "queued" });
      const { clientAnswerId } = outcome as { clientAnswerId: string };
      expect(post).not.toHaveBeenCalled();
      expect(store.getState().pendingAnswers[pendingAnswerKey(SLIDE_IDS[0], 0)]).toMatchObject({ status: "queued", clientAnswerId });
      expect(store.getState().submittedSlideIndex).toBeNull();
      const [entry] = await storage.list(PID);
      expect(entry).toMatchObject({
        clientAnswerId,
        sessionId: SID,
        slideId: SLIDE_IDS[0],
        body: { clientAnswerId, slideTicket: "st1.ticket-open", optionIndex: 1, participantToken: SELF.token },
      });
      expect("offline" in entry.body).toBe(false);

      online.value = true;
      await store.getState().flushAnswerQueue();
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][1]).toMatchObject({ clientAnswerId, offline: true, slideTicket: "st1.ticket-open" });
      expect(store.getState().pendingAnswers).toEqual({});
      expect(store.getState().submittedSlideIndex).toBe(0);
      expect(await storage.list(PID)).toEqual([]);

      // A second flush sends nothing again.
      await store.getState().flushAnswerQueue();
      expect(post).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("online but unreachable: socket, REST and its re-sends fail, then the answer is queued", async () => {
    const storage = createMemoryAnswerStorage();
    const post = spyOn(apiClient, "post").mockRejectedValue(new AxiosError("Network Error"));
    try {
      const store = participant(storage, { value: true });
      const { transport, calls } = transportOf(async () => Promise.reject(new Error("timeout")));
      store.getState().setAnswerTransport(transport);
      const outcome = await store.getState().submitAnswer({ optionIndex: 0 });
      expect(outcome).toMatchObject({ status: "queued" });
      expect(calls).toHaveLength(1);
      expect(post).toHaveBeenCalledTimes(3);
      const ids = new Set([calls[0].clientAnswerId, ...post.mock.calls.map((c) => (c[1] as AnswerRequest).clientAnswerId)]);
      expect(ids.size).toBe(1);
      expect(await storage.list(PID)).toHaveLength(1);
    } finally {
      post.mockRestore();
    }
  });

  test("the joined socket carries live answers; REST is not used", async () => {
    const post = spyOn(apiClient, "post").mockResolvedValue(okPost());
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participant(createMemoryAnswerStorage(), { value: true });
      const { transport, calls } = transportOf(async () => okAck());
      store.getState().setAnswerTransport(transport);
      expect(await store.getState().submitAnswer({ optionIndex: 0 })).toMatchObject({ status: "accepted", replay: false });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ slideTicket: "st1.ticket-open", optionIndex: 0 });
      expect(post).not.toHaveBeenCalled();
      expect(store.getState().submittedSlideIndex).toBe(0);
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("the socket rejoining (transport registered) sends the queue over it", async () => {
    const storage = createMemoryAnswerStorage();
    const online = { value: false };
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participant(storage, online);
      const stop = store.getState().startAnswerSync();
      await store.getState().submitAnswer({ optionIndex: 1 });
      online.value = true;
      const { transport, calls } = transportOf(async () => okAck());
      store.getState().setAnswerTransport(transport);
      for (let i = 0; i < 20 && calls.length === 0; i++) await tick();
      await store.getState().flushAnswerQueue(false);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ offline: true });
      expect(store.getState().pendingAnswers).toEqual({});
      expect(store.getState().submittedSlideIndex).toBe(0);
      stop();
    } finally {
      get.mockRestore();
    }
  });

  test("a queued answer the server refuses (TIME_UP) shows why, and the phone re-reads its state", async () => {
    const storage = createMemoryAnswerStorage();
    const online = { value: false };
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(400, "TIME_UP", "Time is up"));
    const get = spyOn(apiClient, "get").mockResolvedValue({ data: { data: liveState({}, { phase: "closed", slideTicket: null }) } });
    try {
      const store = participant(storage, online);
      const stop = store.getState().startAnswerSync();
      await store.getState().submitAnswer({ optionIndex: 1 });
      online.value = true;
      await store.getState().flushAnswerQueue();
      await tick();
      expect(store.getState().pendingAnswers[pendingAnswerKey(SLIDE_IDS[0], 0)]).toMatchObject({
        status: "refused",
        code: "TIME_UP",
        message: "Time is up",
      });
      expect(store.getState().submittedSlideIndex).toBeNull();
      expect(get).toHaveBeenCalledWith(`/presentations/${PID}/live-state`, expect.anything());
      expect(store.getState().phase).toBe("closed");
      expect(await storage.list(PID)).toEqual([]);
      stop();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("ALREADY_ANSWERED for a queued answer counts as answered", async () => {
    const storage = createMemoryAnswerStorage();
    const online = { value: false };
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(409, "ALREADY_ANSWERED"));
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = participant(storage, online);
      const stop = store.getState().startAnswerSync();
      await store.getState().submitAnswer({ optionIndex: 1 });
      online.value = true;
      await store.getState().flushAnswerQueue();
      expect(store.getState().pendingAnswers).toEqual({});
      expect(store.getState().submittedSlideIndex).toBe(0);
      stop();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("after a reload the queue shows the answer as saved again, then syncs it", async () => {
    const storage = createMemoryAnswerStorage();
    const online = { value: false };
    const post = spyOn(apiClient, "post").mockResolvedValue(okPost({ replay: false, via: "offline" }));
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const before = participant(storage, online);
      const { clientAnswerId } = (await before.getState().submitAnswer({ optionIndex: 1 })) as { clientAnswerId: string };

      // A fresh page: a new store over the same (persisted) queue.
      const after = participant(storage, online);
      expect(after.getState().pendingAnswers).toEqual({});
      const stop = after.getState().startAnswerSync();
      await after.getState().flushAnswerQueue();
      expect(after.getState().pendingAnswers[pendingAnswerKey(SLIDE_IDS[0], 0)]).toMatchObject({ status: "queued", clientAnswerId });

      online.value = true;
      await after.getState().flushAnswerQueue();
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][1]).toMatchObject({ clientAnswerId, offline: true });
      expect(after.getState().pendingAnswers).toEqual({});
      expect(after.getState().submittedSlideIndex).toBe(0);
      stop();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test("another identity's leftovers are sent but never touch this participant's screen", async () => {
    const storage = createMemoryAnswerStorage();
    await storage.put(queued({ clientAnswerId: "old-session", sessionId: SID2, participantId: "p0", queuedAt: Date.now() }));
    const post = spyOn(apiClient, "post").mockRejectedValue(apiFailure(409, "PARTICIPANT_STALE"));
    try {
      const store = participant(storage, { value: true });
      const stop = store.getState().startAnswerSync();
      await store.getState().flushAnswerQueue();
      expect(post).toHaveBeenCalledTimes(1);
      expect(store.getState().pendingAnswers).toEqual({});
      expect(store.getState().lost).toBeNull();
      expect(await storage.list(PID)).toEqual([]);
      stop();
    } finally {
      post.mockRestore();
    }
  });

  test("a live-state snapshot read before the queued answer landed does not undo 'answered'", async () => {
    const storage = createMemoryAnswerStorage();
    const online = { value: false };
    const snapshot = deferred<{ data: { data: unknown } }>();
    const post = spyOn(apiClient, "post").mockResolvedValue(okPost());
    const get = spyOn(apiClient, "get").mockImplementation((async (url: string) => {
      if (url.endsWith("/live-state")) return snapshot.promise;
      throw new Error("offline");
    }) as typeof apiClient.get);
    try {
      const store = participant(storage, online);
      const stop = store.getState().startAnswerSync();
      await store.getState().submitAnswer({ optionIndex: 1 });
      online.value = true;
      const resync = store.getState().loadLiveState();
      await store.getState().flushAnswerQueue();
      expect(store.getState().submittedSlideIndex).toBe(0);
      // The snapshot was read before the answer arrived: answeredCurrent false.
      snapshot.resolve({ data: { data: liveState() } });
      expect(await resync).toBe(true);
      expect(store.getState().submittedSlideIndex).toBe(0);
      expect(store.getState().pendingAnswers).toEqual({});
      stop();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });
});
