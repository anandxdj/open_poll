import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import "@/features/registrations";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { HostControls } from "@/features/presentations/components/host/HostControls";
import { ParticipantSlide } from "@/features/presentations/components/participant/ParticipantSlide";
import { Stage } from "@/features/presentations/components/stage/Stage";
import type { LiveState } from "@/features/presentations/live/reducer";
import { ParticipantEnd } from "@/features/presentations/components/participant/ParticipantEnd";
import { registerSlot } from "@/features/presentations/live/slots";
import { createLiveStore, LiveStoreProvider, useLive } from "@/features/presentations/live/store";
import { getSlideRuntime } from "@/features/presentations/slides/runtime";
import { deck, headingSlide, liveSlide, PID, SELF, SID, SLIDE_IDS, standings } from "./live.fixtures";

// What the host and the participant see in each state of a session. Server
// rendered, so these cover markup per state, not interaction.

const noJoin = { playUrl: "", copiedUrl: false, copiedCode: false, copyUrl: () => {}, copyCode: () => {} };
const countdown = { timed: false, secondsLeft: 0, progress: 1 };

function hostStore(init: Partial<LiveState>) {
  return createLiveStore("host", { presentationId: PID, sessionId: SID, deck: deck(), totalSlides: 3, title: "Deck", joinCode: "123456", ...init });
}

const renderWith = (store: ReturnType<typeof createLiveStore>, node: React.ReactNode) =>
  renderToStaticMarkup(
    <LiveIntlProvider>
      <LiveStoreProvider store={store}>{node}</LiveStoreProvider>
    </LiveIntlProvider>
  );

const controls = (init: Partial<LiveState>, busy = false) =>
  renderWith(
    hostStore(init),
    <HostControls busy={busy} onPrevious={() => {}} onNext={() => {}} onCloseVoting={() => {}} onReopenVoting={() => {}} onReveal={() => {}} onEnd={() => {}} />
  );

describe("host controls", () => {
  const onQuestion = (phase: LiveState["phase"], extra: Partial<LiveState> = {}): Partial<LiveState> => ({
    status: "active",
    currentSlideIndex: 0,
    slideId: SLIDE_IDS[0],
    phase,
    ...extra,
  });

  test("an open slide offers Close voting and Reveal (also when untimed), not Reopen", () => {
    const html = controls(onQuestion("open", { timing: { startedAt: null, endsAt: null, clockOffsetMs: 0 } }));
    expect(html).toContain("Close voting");
    expect(html).toContain("Reveal");
    expect(html).not.toContain("Reopen");
    expect(html).toContain("Next Slide");
  });

  test("a closed slide offers Reveal and Reopen, not Close voting", () => {
    const html = controls(onQuestion("closed"));
    expect(html).not.toContain("Close voting");
    expect(html).toContain("Reveal");
    expect(html).toContain("Reopen");
  });

  test("a revealed slide offers Reopen only", () => {
    const html = controls(onQuestion("revealed"));
    expect(html).not.toContain("Close voting");
    expect(html).not.toContain(">Reveal<");
    expect(html).toContain("Reopen");
  });

  test("a content slide has no voting controls", () => {
    const html = controls({ status: "active", currentSlideIndex: 1, slideId: SLIDE_IDS[1], phase: "shown" });
    for (const label of ["Close voting", "Reveal", "Reopen"]) expect(html).not.toContain(label);
    expect(html).toContain("Prev Slide");
    expect(html).toContain("Next Slide");
  });

  test("the first slide cannot go back; the last offers End Session instead of Next", () => {
    const first = controls(onQuestion("open"));
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Prev Slide/);
    const last = controls({ status: "active", currentSlideIndex: 2, slideId: SLIDE_IDS[2], phase: "shown", isLastSlide: true });
    expect(last).toContain("End Session");
    expect(last).not.toContain("Next Slide");
    expect(last).toContain("3 / 3");
  });

  test("nothing but the footer frame while no session runs", () => {
    for (const status of ["draft", "lobby", "ended"] as const) {
      const html = controls({ status });
      for (const label of ["Prev Slide", "Next Slide", "End Session", "Close voting"]) expect(html).not.toContain(label);
    }
  });
});

describe("host stage", () => {
  const stage = (init: Partial<LiveState>) =>
    renderWith(
      hostStore(init),
      <Stage
        surface="host"
        join={noJoin}
        countdown={countdown}
        readyActions={<button>READY-ACTION</button>}
        lobbyActions={<button>LOBBY-ACTION</button>}
        endActions={<button>END-ACTION</button>}
      />
    );

  test("a deck never presented shows the ready screen with its actions and no join code", () => {
    const html = stage({ status: "draft", sessionId: null });
    expect(html).toContain("Ready to present");
    expect(html).toContain("READY-ACTION");
    expect(html).not.toContain("LOBBY-ACTION");
    expect(html).not.toContain("JOIN CODE");
  });

  test("the lobby shows the join code, who joined and its actions", () => {
    const html = stage({ status: "lobby", participants: [{ participantId: "p1", name: "Ada" }] });
    expect(html).toContain("JOIN CODE");
    expect(html).toContain("123456");
    expect(html).toContain("1 JOINED");
    expect(html).toContain("LOBBY-ACTION");
  });

  test("an ended session shows the final standings and the end actions", () => {
    const html = stage({ status: "ended", leaderboard: standings });
    expect(html).toContain("Session ended");
    expect(html).toContain("Final standings");
    expect(html).toContain("END-ACTION");
  });

  test("a response slide shows its phase; an untimed open one says there is no limit", () => {
    const open = stage({ status: "active", currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "open", timing: { startedAt: null, endsAt: null, clockOffsetMs: 0 } });
    expect(open).toContain("SLIDE 1 OF 3");
    expect(open).toContain("Voting open");
    expect(open).toContain("No time limit");
    expect(open).not.toContain("Time left");
    expect(stage({ status: "active", currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "closed" })).toContain("Voting closed");
  });

  test("the timer shows for a timed open window and not once voting closed", () => {
    const timed = renderWith(
      hostStore({ status: "active", currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "open" }),
      <Stage surface="host" join={noJoin} countdown={{ timed: true, secondsLeft: 12, progress: 0.4 }} />
    );
    expect(timed).toContain("Time left");
    const closed = renderWith(
      hostStore({ status: "active", currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "closed" }),
      <Stage surface="host" join={noJoin} countdown={{ timed: true, secondsLeft: 12, progress: 0.4 }} />
    );
    expect(closed).not.toContain("Time left");
  });

  test("a content slide shows without voting chrome or the answer counter", () => {
    const html = stage({ status: "active", currentSlideIndex: 1, slideId: SLIDE_IDS[1], phase: "shown" });
    expect(html).toContain("SLIDE 2 OF 3");
    expect(html).not.toContain("Voting");
    expect(html).not.toContain("answered");
  });
});

describe("end screens expose the session to the endScreen slot", () => {
  // Modules (session reports, take-home links) read the session id from the live store.
  function SessionLink({ role }: { role: string }) {
    const sessionId = useLive((s) => s.sessionId);
    return <a href={`/live/123456/summary?sid=${sessionId}`}>{`summary:${role}`}</a>;
  }

  test("host and participant end screens render the slot, and the store carries the session id", () => {
    const unregister = registerSlot("endScreen", { id: "test-summary", Component: SessionLink });
    try {
      const host = renderWith(
        hostStore({ status: "ended", leaderboard: standings }),
        <Stage surface="host" join={noJoin} countdown={countdown} />
      );
      expect(host).toContain(`summary:host`);
      expect(host).toContain(`sid=${SID}`);

      const participant = renderWith(
        createLiveStore("participant", { presentationId: PID, sessionId: SID, self: SELF, status: "ended", leaderboard: standings }),
        <ParticipantEnd />
      );
      expect(participant).toContain(`summary:participant`);
      expect(participant).toContain(`sid=${SID}`);
    } finally {
      unregister();
    }
  });
});

describe("participant slide", () => {
  const select = getSlideRuntime("select_answer")!;

  const participant = (init: Partial<LiveState>, slide = liveSlide()) => {
    const store = createLiveStore("participant", {
      presentationId: PID,
      sessionId: SID,
      self: SELF,
      status: "active",
      totalSlides: 3,
      currentSlideIndex: 0,
      slideId: SLIDE_IDS[0],
      slide,
      ...init,
    });
    return renderWith(store, <ParticipantSlide slide={slide} runtime={select} />);
  };

  const timing = { startedAt: "2026-01-01T00:00:00.000Z", endsAt: null, clockOffsetMs: 0 };
  const lastAnswer = { slideId: SLIDE_IDS[0], slideIndex: 0, isCorrect: true, score: 900, scored: true };
  const me = { participantId: "p1", name: "Ada", totalScore: 900, correctCount: 1, rank: 1, lastAnswer, quizStatus: "active" as const };
  const revealed = { slideIndex: 0 } as LiveState["reveal"];

  test("an open untimed slide shows the answer form and no timer", () => {
    const html = participant({ phase: "open", timing });
    expect(html).toContain("Submit Answer");
    expect(html).not.toContain("Time left");
  });

  test("closed and not answered: voting is closed, no form", () => {
    const html = participant({ phase: "closed" });
    expect(html).toContain("Voting is closed");
    expect(html).not.toContain("Submit Answer");
  });

  test("closed and answered: the answer is locked in", () => {
    const html = participant({ phase: "closed", submittedSlideIndex: 0 });
    expect(html).toContain("Answer locked in!");
    expect(html).not.toContain("Voting is closed");
  });

  test("revealed and not answered: time's up for a timed slide, voting closed for an untimed one", () => {
    expect(participant({ phase: "revealed", reveal: revealed })).toContain("Time&#x27;s up!");
    expect(participant({ phase: "revealed", reveal: revealed }, liveSlide({ timeLimit: 0 }))).toContain("Voting is closed");
  });

  test("revealed and answered: the result, taken from the last answer of this slide", () => {
    const html = participant({ phase: "revealed", reveal: revealed, submittedSlideIndex: 0, me });
    expect(html).toContain("Correct!");
    expect(html).toContain("+900");
  });

  test("a last answer that belongs to another slide is not shown as this slide's result", () => {
    const stale = { ...me, lastAnswer: { ...lastAnswer, slideId: SLIDE_IDS[1], slideIndex: 1 } };
    const html = participant({ phase: "revealed", reveal: revealed, submittedSlideIndex: 0, me: stale });
    expect(html).not.toContain("Correct!");
    expect(html).toContain("Answer locked in!");
  });

  test("a content slide's participant view says to look at the screen", () => {
    const heading = getSlideRuntime("heading")!;
    const html = renderWith(
      createLiveStore("participant", { presentationId: PID, sessionId: SID, self: SELF, status: "active", slide: headingSlide(), phase: "shown" }),
      <heading.ParticipantView slide={headingSlide()} mode="live" onSubmit={() => {}} submitting={false} />
    );
    expect(html).toContain("Look at the screen");
  });
});
