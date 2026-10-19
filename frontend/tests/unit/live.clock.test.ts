import { describe, expect, test } from "bun:test";

import { clockOffsetFrom, countdownAt } from "@/features/presentations/live/clock";
import { createInitialLiveState, liveReducer, type LiveState } from "@/features/presentations/live/reducer";
import {
  PID,
  SELF,
  SID,
  SLIDE_IDS,
  T0,
  at,
  event,
  liveSlide,
  liveState,
  run,
} from "./live.fixtures";

// Plan §0 item 12: the old countdown paired the `serverNow` captured once at
// page load with "now" at every question, so a participant who waited in the
// lobby saw a countdown that ran long by the wait. The offset must be measured
// per event (and per REST response) from that message's own `serverNow`.

describe("clockOffsetFrom", () => {
  test("is the server clock minus the client clock at arrival", () => {
    expect(clockOffsetFrom(at(10), T0 + 4000)).toBe(6000);
    expect(clockOffsetFrom(at(10), T0 + 14_000)).toBe(-4000);
  });

  test("is null without a usable serverNow or arrival time", () => {
    expect(clockOffsetFrom(undefined, T0)).toBeNull();
    expect(clockOffsetFrom("", T0)).toBeNull();
    expect(clockOffsetFrom("not a date", T0)).toBeNull();
    expect(clockOffsetFrom(at(1), undefined)).toBeNull();
  });
});

describe("countdownAt", () => {
  const timing = (endsAt: string | null, clockOffsetMs = 0) => ({ endsAt, clockOffsetMs });

  test("counts down on the server clock", () => {
    const value = countdownAt(timing(at(30)), T0 + 12_400, 30);
    expect(value).toMatchObject({ timed: true, expired: false, secondsLeft: 18, progress: 17_600 / 30_000 });
    expect(value.msLeft).toBe(17_600);
  });

  test("a client clock that is off does not shift the deadline", () => {
    // Client clock 5 minutes ahead of the server (offset −300 s).
    const offset = -300_000;
    const value = countdownAt(timing(at(30), offset), T0 + 300_000 + 10_000, 30);
    expect(value.secondsLeft).toBe(20);
  });

  test("expires at the deadline and stays expired", () => {
    expect(countdownAt(timing(at(30)), T0 + 30_000, 30)).toMatchObject({ expired: true, msLeft: 0, secondsLeft: 0, progress: 0 });
    expect(countdownAt(timing(at(30)), T0 + 99_000, 30).expired).toBe(true);
  });

  test("never shows more than the slide's own time budget", () => {
    // A client clock far behind the server would otherwise read minutes.
    expect(countdownAt(timing(at(30), 0), T0 - 120_000, 30).msLeft).toBe(30_000);
  });

  test("an untimed window has no timer and never expires", () => {
    expect(countdownAt(timing(null), T0 + 1e9, 30)).toEqual({ timed: false, msLeft: 0, secondsLeft: 0, progress: 1, expired: false });
    expect(countdownAt(null, T0, 30).timed).toBe(false);
  });

  test("without a client clock (server render) shows the full budget", () => {
    expect(countdownAt(timing(at(30)), Number.NaN, 30)).toMatchObject({ timed: true, secondsLeft: 30, progress: 1, expired: false });
  });
});

describe("countdown after waiting in the lobby", () => {
  const LOBBY_WAIT_S = 90;
  const TIME_LIMIT_S = 30;

  /**
   * The previous implementation, as a pure function: on a new deadline it set
   * `offset = new Date(serverNow) - Date.now()` — with the `serverNow` read
   * once when the page loaded — and ticked `endsAt - (Date.now() + offset)`.
   */
  const legacyMsLeft = (opts: { pageLoadServerNow: string; deadlineSeenAtMs: number; endsAt: string; nowMs: number }) => {
    const offset = Date.parse(opts.pageLoadServerNow) - opts.deadlineSeenAtMs;
    return Math.max(0, Date.parse(opts.endsAt) - (opts.nowMs + offset));
  };

  // Client clock == server clock here; only the wait matters.
  const clientAtPageLoad = T0;
  const clientAtQuestion = T0 + LOBBY_WAIT_S * 1000;

  test("the legacy computation reproduces the bug: the countdown runs long by the whole wait", () => {
    const msLeft = legacyMsLeft({
      pageLoadServerNow: at(0),
      deadlineSeenAtMs: clientAtQuestion,
      endsAt: at(LOBBY_WAIT_S + TIME_LIMIT_S),
      nowMs: clientAtQuestion + 1000,
    });
    // 30 s limit, 1 s in — and it reads about two minutes.
    expect(msLeft).toBeGreaterThan(TIME_LIMIT_S * 1000 * 3);
  });

  test("the offset measured from the question event keeps it within the limit", () => {
    const lobby = liveReducer(createInitialLiveState("participant"), {
      type: "participant/info-loaded",
      info: { presentationId: PID, sessionId: SID, title: "Deck", status: "lobby", totalSlides: 3, currentSlideIndex: -1, serverNow: at(0) },
      self: SELF,
      receivedAt: clientAtPageLoad,
    });
    const asked = liveReducer(
      lobby,
      event(
        "question:started",
        {
          slideId: SLIDE_IDS[0],
          slideIndex: 0,
          slide: liveSlide(),
          startedAt: at(LOBBY_WAIT_S),
          endsAt: at(LOBBY_WAIT_S + TIME_LIMIT_S),
          serverNow: at(LOBBY_WAIT_S),
          isLastSlide: false,
          reopened: false,
        },
        { receivedAt: clientAtQuestion }
      )
    );
    const value = countdownAt(asked.timing, clientAtQuestion + 1000, TIME_LIMIT_S);
    expect(value.secondsLeft).toBe(29);
    expect(value.msLeft).toBeLessThanOrEqual(TIME_LIMIT_S * 1000);
  });

  test("each question takes its own sample, so a drifting client clock cannot accumulate", () => {
    // Q1 arrives while the client clock agrees with the server, Q2 after it drifted 2 s behind.
    const first = run(
      createInitialLiveState("participant", { presentationId: PID, sessionId: SID, self: SELF, status: "lobby", totalSlides: 3 }),
      event("question:started", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), startedAt: at(10), endsAt: at(40), serverNow: at(10), isLastSlide: false, reopened: false }, { receivedAt: T0 + 10_000 })
    );
    expect(first.timing?.clockOffsetMs).toBe(0);
    const second = liveReducer(
      first,
      event("question:started", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: liveSlide({ slideIndex: 1 }), startedAt: at(100), endsAt: at(130), serverNow: at(100), isLastSlide: false, reopened: false }, { receivedAt: T0 + 100_000 - 2000 })
    );
    expect(second.timing?.clockOffsetMs).toBe(2000);
    expect(countdownAt(second.timing, T0 + 100_000 - 2000, 30).secondsLeft).toBe(30);
  });

  test("a resync takes a fresh sample from the response, not the page-load one", () => {
    const state: LiveState = {
      ...createInitialLiveState("participant", { presentationId: PID, sessionId: SID, self: SELF, status: "active", totalSlides: 3 }),
      clockOffsetMs: 0,
    };
    // Client is 4 s ahead of the server when the response lands at client T0+60 s.
    const next = liveReducer(state, {
      type: "participant/live-state",
      state: liveState({ serverNow: at(56) }, { startedAt: at(50), endsAt: at(80) }),
      receivedAt: T0 + 60_000,
    });
    expect(next.timing?.clockOffsetMs).toBe(-4000);
    expect(countdownAt(next.timing, T0 + 60_000, 30).secondsLeft).toBe(24);
  });

  test("an event without serverNow falls back to the latest sample", () => {
    const state = { ...createInitialLiveState("participant", { presentationId: PID, sessionId: SID, self: SELF, status: "lobby", totalSlides: 3 }), clockOffsetMs: 1500 };
    const next = liveReducer(
      state,
      event("question:started", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), startedAt: at(10), endsAt: at(40), isLastSlide: false, reopened: false }, { receivedAt: T0 + 10_000 })
    );
    expect(next.timing?.clockOffsetMs).toBe(1500);
  });
});
