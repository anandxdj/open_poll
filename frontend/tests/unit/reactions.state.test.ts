import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createInitialLiveState, liveReducer, type LiveAction } from "@/features/presentations/live/reducer";
import type { PresentationRealtimeEvent } from "@/features/presentations/types";
import { registerReactionsModule } from "@/features/reactions/module";
import { makeFloaters } from "@/features/reactions/components/ReactionsOverlay";
import { createGate } from "@/features/reactions/components/ReactionsBar";
import { floatersFor, readBurstCounts, type ReactionState } from "@/features/reactions/state";

let dispose: () => void;
beforeAll(() => {
  dispose = registerReactionsModule();
});
afterAll(() => dispose());

const burst = (counts: unknown): LiveAction => ({
  type: "live/event",
  event: {
    quizId: "p",
    presentationId: "p",
    type: "reaction:burst",
    payload: { counts },
    emittedAt: "2026-01-01T00:00:00.000Z",
  } as PresentationRealtimeEvent,
});

describe("reaction slice", () => {
  test("each burst bumps the counter, even with identical counts", () => {
    let state = createInitialLiveState("host");
    expect((state.modules.reaction as ReactionState).burstId).toBe(0);
    state = liveReducer(state, burst({ "👍": 3 }));
    state = liveReducer(state, burst({ "👍": 3 }));
    expect(state.modules.reaction).toEqual({ burstId: 2, counts: { "👍": 3 } });
  });

  test("empty or malformed bursts change nothing", () => {
    const state = createInitialLiveState("host");
    expect(liveReducer(state, burst({}))).toBe(state);
    expect(liveReducer(state, burst("nope"))).toBe(state);
    expect(liveReducer(state, burst(null))).toBe(state);
  });

  test("counts are sanitized: positive integers of short keys, capped", () => {
    expect(readBurstCounts({ counts: { "👍": 2.9, "": 4, x: -1, y: "3", z: 99999, ["a".repeat(17)]: 1 } })).toEqual({
      "👍": 2,
      z: 10000,
    });
  });
});

describe("floating emoji", () => {
  test("a loud burst floats a bounded number of emoji, most popular first", () => {
    const floaters = floatersFor({ "👍": 200, "🎉": 3, "❤️": 40 });
    expect(floaters.length).toBeLessThanOrEqual(24);
    expect(floaters.filter((e) => e === "👍")).toHaveLength(8);
    expect(floaters[0]).toBe("👍");
    expect(floaters.filter((e) => e === "🎉")).toHaveLength(3);
  });

  test("makeFloaters gives unique ids and positions inside the stage", () => {
    const floaters = makeFloaters({ "👍": 5, "🎉": 5 }, 10, () => 0.5);
    expect(floaters.map((f) => f.id)).toEqual(Array.from({ length: 10 }, (_, i) => 10 + i));
    for (const f of floaters) {
      expect(f.left).toBeGreaterThanOrEqual(0);
      expect(f.left).toBeLessThanOrEqual(100);
      expect(f.duration).toBeGreaterThan(0);
    }
  });
});

describe("send gate", () => {
  test("lets one tap through per gap", () => {
    let now = 1000;
    const gate = createGate(200, () => now);
    expect(gate()).toBe(true);
    now += 100;
    expect(gate()).toBe(false);
    now += 100;
    expect(gate()).toBe(true);
  });
});
