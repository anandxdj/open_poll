import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import "@/features/registrations";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { ParticipantSlide } from "@/features/presentations/components/participant/ParticipantSlide";
import type { HostSession } from "@/features/presentations/components/host/useHostSession";
import { answerFailureVerdict, LIVE_ERROR_CODES } from "@/features/presentations/live/errors";
import { createInitialLiveState, type LiveState } from "@/features/presentations/live/reducer";
import { createLiveStore, LiveStoreProvider } from "@/features/presentations/live/store";
import { getSlideRuntime } from "@/features/presentations/slides/runtime";
import { liveStateData } from "@/features/presenter/audienceChannel";
import { NextSlidePreview, nextSlideIndex } from "@/features/presenter/components/NextSlidePreview";
import { NotesPanel, notesSlideIndex } from "@/features/presenter/components/NotesPanel";
import { PresenterControls } from "@/features/presenter/components/PresenterControls";
import { ResponseCounter } from "@/features/presenter/components/ResponseCounter";
import { formatElapsed } from "@/features/presenter/components/SessionClock";
import { initialRemotePresence, remotePresenceReducer } from "@/features/presenter/remoteState";
import {
  at,
  deck,
  event,
  hostState,
  liveSlide,
  liveState,
  PID,
  run,
  SELF,
  sessionView,
  SID,
  SLIDE_IDS,
  slide,
} from "./live.fixtures";

// W2-A presenter tools on the client: the reducer's `slide:timing` and
// `participant:kicked`, paused timers on the stage, the phone and the presenter
// view, the audience-window snapshot, the remote presence slice.

const timing = (overrides: Record<string, unknown> = {}) => ({
  slideId: SLIDE_IDS[0],
  slideIndex: 0,
  action: "pause",
  startedAt: at(0),
  endsAt: null,
  pausedRemainingMs: 18_000,
  durationMs: 30_000,
  addedSeconds: 0,
  serverNow: at(12),
  ...overrides,
});

const hostOnQuestion = (): LiveState =>
  run(createInitialLiveState("host", { presentationId: PID }), {
    type: "host/state-loaded",
    state: hostState(sessionView()),
    receivedAt: Date.parse(at(1)),
  });

const participantOnQuestion = (): LiveState =>
  run(createInitialLiveState("participant", { presentationId: PID, self: SELF }), {
    type: "participant/live-state",
    state: liveState(),
    receivedAt: Date.parse(at(10)),
  });

describe("slide:timing", () => {
  test("pauses, extends and resumes the host's open window", () => {
    const paused = run(hostOnQuestion(), event("slide:timing", timing(), { receivedAt: Date.parse(at(12)) }));
    expect(paused.timing).toMatchObject({ startedAt: at(0), endsAt: null, pausedRemainingMs: 18_000, durationMs: 30_000 });
    expect(paused.phase).toBe("open");

    const extended = run(paused, event("slide:timing", timing({ action: "extend", pausedRemainingMs: 48_000, durationMs: 60_000, addedSeconds: 30 })));
    expect(extended.timing).toMatchObject({ pausedRemainingMs: 48_000, durationMs: 60_000 });

    const resumed = run(extended, event("slide:timing", timing({ action: "resume", endsAt: at(70), pausedRemainingMs: null, durationMs: 60_000 })));
    expect(resumed.timing).toMatchObject({ endsAt: at(70), durationMs: 60_000 });
    expect(resumed.timing?.pausedRemainingMs ?? null).toBeNull();
  });

  test("reaches the phone too", () => {
    const paused = run(participantOnQuestion(), event("slide:timing", timing()));
    expect(paused.timing).toMatchObject({ endsAt: null, pausedRemainingMs: 18_000 });
    expect(paused.slideTicket).toBe("st1.ticket-open");
  });

  test("ignores an event for another slide or an older run of the slide", () => {
    const state = hostOnQuestion();
    expect(run(state, event("slide:timing", timing({ slideId: SLIDE_IDS[1] }))).timing).toEqual(state.timing);
    expect(run(state, event("slide:timing", timing({ startedAt: at(-100) }))).timing).toEqual(state.timing);
  });

  test("a timer command's response wins over an older window kept from events", () => {
    const state = hostOnQuestion();
    const response = {
      ...deck(),
      session: sessionView({}, { endsAt: null, pausedRemainingMs: 20_000, pausedAt: at(10), durationMs: 30_000 }),
    };
    const next = run(state, { type: "host/command", response });
    expect(next.timing).toMatchObject({ endsAt: null, pausedRemainingMs: 20_000, durationMs: 30_000 });
  });

  test("the host state brings the session's start time for the session clock", () => {
    expect(hostOnQuestion().sessionStartedAt).toBe(at(-60));
  });
});

describe("participant:kicked", () => {
  test("the host's list and standings drop the participant", () => {
    const state = { ...hostOnQuestion(), leaderboard: [{ participantId: "p2", name: "Grace", score: 1, correctCount: 0, rank: 1 }] };
    const next = run(state, event("participant:kicked", { participantId: "p2", name: "Grace", participantCount: 1 }));
    expect(next.participants.map((p) => p.participantId)).toEqual(["p1"]);
    expect(next.leaderboard).toEqual([]);
  });

  test("the removed phone forgets its identity and shows the removed screen", () => {
    const next = run(participantOnQuestion(), event("participant:kicked", { participantId: SELF.participantId, name: "Ada", participantCount: 1 }));
    expect(next.lost).toBe("kicked");
    expect(next.self).toBeNull();
  });
});

describe("answers while paused", () => {
  test("SLIDE_PAUSED is retried with the same id (the queue sends it once the timer resumes)", () => {
    expect(answerFailureVerdict(409, LIVE_ERROR_CODES.slidePaused)).toBe("retry");
    expect(answerFailureVerdict(409, LIVE_ERROR_CODES.alreadyAnswered)).toBe("final");
  });
});

describe("remote presence", () => {
  test("follows remote:connected / remote:disconnected and status reads", () => {
    const connected = remotePresenceReducer(initialRemotePresence, event("remote:connected", { at: at(5) }), createInitialLiveState());
    expect(connected).toEqual({ connected: true, bound: true, at: at(5) });
    const gone = remotePresenceReducer(connected, event("remote:disconnected", { at: at(9) }), createInitialLiveState());
    expect(gone).toEqual({ connected: false, bound: true, at: at(9) });
    // A new pairing (status read) is neither bound nor connected yet.
    const fresh = remotePresenceReducer(gone, { type: "live/module", prefix: "remote", name: "status", payload: { connected: false, bound: false } }, createInitialLiveState());
    expect(fresh).toMatchObject({ connected: false, bound: false });
    const read = remotePresenceReducer(fresh, { type: "live/module", prefix: "remote", name: "status", payload: { connected: true } }, createInitialLiveState());
    expect(read).toMatchObject({ connected: true, bound: true });
    expect(remotePresenceReducer(read, event("slide:shown", {}), createInitialLiveState())).toBe(read);
  });
});

describe("audience window snapshot", () => {
  test("carries the live state's data and no functions (BroadcastChannel clones it)", () => {
    const store = createLiveStore("host", { presentationId: PID, sessionId: SID, deck: deck() });
    const data = liveStateData(store.getState());
    expect(Object.values(data).some((value) => typeof value === "function")).toBe(false);
    expect(data).toMatchObject({ role: "host", presentationId: PID, sessionId: SID });
    expect(() => structuredClone(data)).not.toThrow();
  });
});

describe("helpers", () => {
  test("formats the session clock", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(formatElapsed(-5)).toBe("00:00");
  });

  test("picks the notes and next slide before and during a session", () => {
    expect(notesSlideIndex("lobby", -1)).toBe(0);
    expect(notesSlideIndex("active", 2)).toBe(2);
    expect(nextSlideIndex("draft", -1)).toBe(0);
    expect(nextSlideIndex("active", 0)).toBe(1);
  });
});

// ---------- Markup ----------

const withNotes = deck({
  slides: [
    slide({ notes: "Ask who has been to Paris." }),
    slide({ type: "heading", question: "", timeLimit: 0, points: 0, content: { title: "Hello", subtitle: "" } }),
    slide({ type: "leaderboard", question: "Standings", timeLimit: 0, points: 0 }),
  ],
});

const render = (init: Partial<LiveState>, node: React.ReactNode, role: "host" | "participant" = "host") =>
  renderToStaticMarkup(
    <LiveIntlProvider>
      <LiveStoreProvider store={createLiveStore(role, { presentationId: PID, sessionId: SID, deck: withNotes, totalSlides: 3, ...init })}>
        {node}
      </LiveStoreProvider>
    </LiveIntlProvider>
  );

const activeQuestion = (extra: Partial<LiveState> = {}): Partial<LiveState> => ({
  status: "active",
  currentSlideIndex: 0,
  slideId: SLIDE_IDS[0],
  phase: "open",
  participants: [
    { participantId: "p1", name: "Ada" },
    { participantId: "p2", name: "Grace" },
  ],
  answeredCount: 1,
  ...extra,
});

const pausedTiming = { startedAt: at(0), endsAt: null, pausedRemainingMs: 12_000, durationMs: 30_000, clockOffsetMs: 0 };

const session = {
  busy: false,
  previous: async () => null,
  next: async () => null,
  closeVoting: async () => null,
  reopenVoting: async () => null,
  reveal: async () => null,
  pauseTimer: async () => null,
  resumeTimer: async () => null,
  extendTimer: async () => null,
  skip: async () => null,
} as unknown as HostSession;

describe("presenter view markup", () => {
  test("shows the current slide's speaker notes, and the next slide", () => {
    const html = render(activeQuestion(), <><NotesPanel /><NextSlidePreview /></>);
    expect(html).toContain("Ask who has been to Paris.");
    expect(html).toContain("Speaker notes");
    expect(html).toContain("Next slide");
    expect(html).toContain("2 / 3");
  });

  test("a slide without notes says so; the last slide has no next slide", () => {
    const html = render(activeQuestion({ currentSlideIndex: 2, slideId: SLIDE_IDS[2], phase: "shown" }), <><NotesPanel /><NextSlidePreview /></>);
    expect(html).toContain("No notes for this slide.");
    expect(html).toContain("This is the last slide.");
  });

  test("counts responses and shows a paused timer", () => {
    const html = render(activeQuestion({ timing: pausedTiming }), <ResponseCounter />);
    expect(html).toContain("1 of 2");
    expect(html).toContain("Timer paused");
  });

  test("offers Resume, +30 s and Skip on a paused timed slide; Pause while it runs", () => {
    const paused = render(activeQuestion({ timing: pausedTiming }), <PresenterControls session={session} onEnd={() => {}} />);
    expect(paused).toContain("Resume timer");
    expect(paused).not.toContain("Pause timer");
    expect(paused).toContain("+30 s");
    expect(paused).toContain("Skip timer");
    const running = render(
      activeQuestion({ timing: { startedAt: at(0), endsAt: new Date(Date.now() + 20_000).toISOString(), clockOffsetMs: 0 } }),
      <PresenterControls session={session} onEnd={() => {}} />
    );
    expect(running).toContain("Pause timer");
  });

  test("an untimed slide has no timer controls", () => {
    const html = render(activeQuestion({ timing: { startedAt: at(0), endsAt: null, clockOffsetMs: 0 } }), <PresenterControls session={session} onEnd={() => {}} />);
    for (const label of ["Pause timer", "Resume timer", "+30 s", "Skip timer"]) expect(html).not.toContain(label);
    expect(html).toContain("Close voting");
  });
});

describe("phone while paused", () => {
  test("shows the paused timer and notice; the form stays usable (sending waits for the resume)", () => {
    const runtime = getSlideRuntime("select_answer")!;
    const html = render(
      { status: "active", currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "open", slide: liveSlide(), self: SELF, timing: pausedTiming },
      <ParticipantSlide slide={liveSlide()} runtime={runtime} />,
      "participant"
    );
    expect(html).toContain("Timer paused");
    expect(html).toContain("The presenter paused the timer.");
    expect(html).toContain("Paused");
    expect(html).not.toContain("animate-spin");
  });
});
