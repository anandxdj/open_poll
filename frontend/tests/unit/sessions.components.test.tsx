import { afterEach, describe, expect, spyOn, test } from "bun:test";
import axios, { AxiosError, type AxiosResponse } from "axios";
import { renderToStaticMarkup } from "react-dom/server";

import { apiClient } from "@/lib/api-client";
import { createLiveStore, LiveStoreProvider } from "@/features/presentations/live/store";
import { getSlotEntries, SlotOutlet } from "@/features/presentations/live/slots";
import "@/features/registrations";
import { SessionsIntlProvider } from "@/features/sessions/SessionsIntlProvider";
import {
  deleteSession,
  disableShare,
  enableShare,
  fileNameFromDisposition,
  getSessionReport,
  listSessions,
  readBlobError,
} from "@/features/sessions/api/sessions";
import { LeaderboardPanel } from "@/features/sessions/components/LeaderboardPanel";
import { ParticipantsTable } from "@/features/sessions/components/ParticipantsTable";
import { PublicResultsContent } from "@/features/sessions/components/PublicResultsView";
import { TakeHomeContent } from "@/features/sessions/components/ParticipantSummary";
import { ReportContent } from "@/features/sessions/components/SessionReportView";
import { ScaledStage, STAGE_DESIGN_WIDTH } from "@/features/sessions/components/ScaledStage";
import { SlideResultCard } from "@/features/sessions/components/SlideResultCard";
import { StatusBadge } from "@/features/sessions/components/ui";
import type { PublicResults, ReportParticipant, SessionReport, TakeHome } from "@/features/sessions/types";
import enSessions from "@/messages/en/sessions.json";

const html = (node: React.ReactNode) => renderToStaticMarkup(<SessionsIntlProvider>{node}</SessionsIntlProvider>);

const OPTIONS_DISTRIBUTION = {
  kind: "options",
  counts: [3, 1],
  options: [
    { text: "Paris", isCorrect: true },
    { text: "Lyon", isCorrect: false },
  ],
};

const participant = (n: number, overrides: Partial<ReportParticipant> = {}): ReportParticipant => ({
  participantId: `p${n}`,
  name: `Player ${n}`,
  rank: n,
  score: 2000 - n * 100,
  correctCount: 1,
  answeredCount: 1,
  joinedAt: "2026-03-02T09:00:00.000Z",
  kicked: false,
  ...overrides,
});

const report = (overrides: Partial<SessionReport> = {}): SessionReport => ({
  session: {
    sessionId: "s1",
    presentationId: "d1",
    title: "Quarterly review",
    runNumber: 2,
    pace: "presenter",
    status: "ended",
    isLive: false,
    startedAt: "2026-03-02T09:00:00.000Z",
    endedAt: "2026-03-02T09:42:00.000Z",
    durationMs: 42 * 60_000,
    participantCount: 4,
    answerCount: 4,
    responseSlideCount: 1,
    participationRate: 1,
    retainUntil: null,
  },
  slides: [
    {
      slideId: "a",
      slideIndex: 0,
      type: "select_answer",
      typeName: "Select answer",
      kind: "interactive",
      lifecycle: "response",
      label: "Capital of France?",
      scored: true,
      visited: true,
      phase: "closed",
      answeredCount: 4,
      distribution: OPTIONS_DISTRIBUTION,
      slide: {
        type: "select_answer",
        question: "Capital of France?",
        options: [
          { text: "Paris", isCorrect: true },
          { text: "Lyon", isCorrect: false },
        ],
        points: 1000,
        timeLimit: 20,
      },
    },
    {
      slideId: "b",
      slideIndex: 1,
      type: "wordcloud",
      typeName: "Word cloud",
      kind: "interactive",
      lifecycle: "response",
      label: "Never shown question",
      scored: false,
      visited: false,
      phase: null,
      answeredCount: 0,
      distribution: null,
      slide: { type: "wordcloud", question: "Never shown question" },
    },
  ],
  leaderboard: [1, 2, 3, 4].map((n) => ({ participantId: `p${n}`, name: `Player ${n}`, score: 2000 - n * 100, correctCount: 1, rank: n })),
  participants: [1, 2, 3, 4].map((n) => participant(n)),
  share: null,
  access: { export: true, share: true, delete: true },
  exports: { plan: "free", csv: true, xlsx: false, pdf: false },
  ...overrides,
});

describe("message catalog", () => {
  test("every string is non-empty English text", () => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        expect([path, value.trim().length > 0]).toEqual([path, true]);
      } else {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, `${path}.${key}`);
      }
    };
    walk(enSessions, "sessions");
  });
});

describe("report content", () => {
  test("shows the key numbers, the slide's chart, standings and participants", () => {
    const markup = html(<ReportContent report={report()} />);
    expect(markup).toContain("Participants");
    expect(markup).toContain("42 min");
    expect(markup).toContain("100%");
    // The slide's own StageView, in a dark stage panel.
    expect(markup).toContain("Capital of France?");
    expect(markup).toContain("Paris");
    expect(markup).toContain("4 responses");
    expect(markup).toContain("Select answer");
    expect(markup).toContain("Leaderboard");
    expect(markup).toContain("Player 1");
    // Slides that never ran are named, not charted.
    expect(markup).toContain("Not shown in this session: 2. Never shown question");
  });

  test("a live session announces that it refreshes", () => {
    const live = report({ session: { ...report().session, isLive: true, status: "active", endedAt: null } });
    expect(html(<ReportContent report={live} />)).toContain("still running");
    expect(html(<ReportContent report={report()} />)).not.toContain("still running");
  });

  test("a session without response slides says so", () => {
    const empty = report({ slides: [], leaderboard: [], participants: [] });
    const markup = html(<ReportContent report={empty} />);
    expect(markup).toContain("No response slides were shown in this session.");
    expect(markup).toContain("Nobody scored in this session.");
    expect(markup).toContain("Nobody joined this session.");
  });

  test("unknown slide types render nothing instead of crashing", () => {
    const markup = html(
      <SlideResultCard
        slideIndex={4}
        slide={{ type: "from_the_future", question: "?" }}
        typeName="Future"
        label="Future slide"
        answeredCount={2}
        distribution={{ kind: "new_shape" }}
        participants={[]}
      />
    );
    expect(markup).toContain("Slide 5");
    expect(markup).toContain("Future slide");
  });
});

describe("scaled stage", () => {
  test("only fixed-layout types ask for a design width", () => {
    expect(STAGE_DESIGN_WIDTH.wordcloud).toBeGreaterThan(600);
    expect(STAGE_DESIGN_WIDTH.select_answer).toBeUndefined();
  });

  test("renders its children as they are before it has measured anything (server render)", () => {
    const markup = renderToStaticMarkup(
      <ScaledStage designWidth={720}>
        <p>chart</p>
      </ScaledStage>
    );
    expect(markup).toContain("<p>chart</p>");
    expect(markup).not.toContain("scale(");
  });
});

describe("standings and participants", () => {
  test("the leaderboard previews ten rows and offers the rest", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ rank: i + 1, name: `P${i + 1}`, score: 100 - i, correctCount: 1 }));
    const markup = html(<LeaderboardPanel rows={rows} />);
    expect(markup).toContain("P10");
    expect(markup).not.toContain("P11<");
    expect(markup).toContain("Show all 25");
  });

  test("the participants table pages, flags removed players, and keeps names as text", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => participant(i + 1)),
      participant(31, { name: "<img src=x onerror=alert(1)>", kicked: true }),
    ];
    const markup = html(<ParticipantsTable participants={many} responseSlides={2} />);
    expect(markup).toContain("Page 1 of 2");
    expect(markup).toContain("Player 25");
    expect(markup).not.toContain("Player 26<");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("1 / 2");
  });

  test("the status badge names the state", () => {
    expect(html(<StatusBadge status="active" />)).toContain("Live");
    expect(html(<StatusBadge status="ended" />)).toContain("Ended");
    expect(html(<StatusBadge status="lobby" />)).toContain("Lobby open");
  });
});

describe("public results", () => {
  const results = (overrides: Partial<PublicResults> = {}): PublicResults => ({
    title: "Quarterly review",
    runNumber: 2,
    startedAt: "2026-03-02T09:00:00.000Z",
    endedAt: "2026-03-02T09:42:00.000Z",
    participantCount: 4,
    answerCount: 4,
    includeNames: false,
    slides: [
      {
        slideIndex: 0,
        type: "select_answer",
        label: "Capital of France?",
        scored: true,
        answeredCount: 4,
        distribution: OPTIONS_DISTRIBUTION,
        slide: { type: "select_answer", question: "Capital of France?", options: [{ text: "Paris" }, { text: "Lyon" }], points: 1000 },
      },
    ],
    leaderboard: null,
    ...overrides,
  });

  test("draws the aggregated results without any names", () => {
    const markup = html(<PublicResultsContent results={results()} />);
    expect(markup).toContain("Quarterly review");
    expect(markup).toContain("Session 2");
    expect(markup).toContain("Capital of France?");
    expect(markup).toContain("Paris");
    expect(markup).not.toContain("Top participants");
  });

  test("shows the standings only when the owner included names", () => {
    const named = results({
      includeNames: true,
      leaderboard: [{ rank: 1, name: "Ada", score: 1800, correctCount: 1 }],
    });
    const markup = html(<PublicResultsContent results={named} />);
    expect(markup).toContain("Leaderboard");
    expect(markup).toContain("Ada");
  });
});

describe("take-home", () => {
  const takeHome = (overrides: Partial<TakeHome> = {}): TakeHome => ({
    session: {
      sessionId: "s1",
      title: "Quarterly review",
      runNumber: 2,
      status: "ended",
      startedAt: "2026-03-02T09:00:00.000Z",
      endedAt: "2026-03-02T09:42:00.000Z",
      participantCount: 120,
    },
    me: { participantId: "p1", name: "Ada", score: 1750, correctCount: 1, rank: 3, answeredCount: 2 },
    slides: [
      {
        slideId: "a",
        slideIndex: 0,
        type: "select_answer",
        label: "Capital of France?",
        scored: true,
        answered: true,
        answer: "Lyon",
        isCorrect: false,
        points: 0,
        timeMs: 4250,
        correctAnswer: "Paris",
      },
      {
        slideId: "b",
        slideIndex: 1,
        type: "wordcloud",
        label: "One word",
        scored: false,
        answered: true,
        answer: "sun",
        isCorrect: null,
        points: null,
        timeMs: 1000,
        correctAnswer: null,
      },
      {
        slideId: "c",
        slideIndex: 2,
        type: "type_answer",
        label: "Largest planet?",
        scored: true,
        answered: false,
        answer: null,
        isCorrect: null,
        points: null,
        timeMs: null,
        correctAnswer: "Jupiter",
      },
    ],
    ...overrides,
  });

  test("shows rank, score, each answer, its status and the correct answer", () => {
    const markup = html(<TakeHomeContent data={takeHome()} />);
    expect(markup).toContain("Ada");
    expect(markup).toContain("#3 of 120");
    expect(markup).toContain("1,750");
    expect(markup).toContain("2 of 3");
    expect(markup).toContain("Lyon");
    expect(markup).toContain("Not quite");
    expect(markup).toContain("Paris");
    expect(markup).toContain("4.3 s to answer");
    expect(markup).toContain("No answer");
    expect(markup).toContain("Skipped");
    expect(markup).toContain("Recorded");
    expect(markup).not.toContain("still running");
  });

  test("a running session explains why results are still coming in", () => {
    const live = takeHome({ session: { ...takeHome().session, status: "active", endedAt: null } });
    expect(html(<TakeHomeContent data={live} />)).toContain("still running");
  });

  test("an ended session offers to remove the participant's answers; a running one does not", () => {
    const remove = async () => {};
    expect(html(<TakeHomeContent data={takeHome()} onRemove={remove} />)).toContain("Remove my answers");
    expect(html(<TakeHomeContent data={takeHome()} />)).not.toContain("Remove my answers");
    const live = takeHome({ session: { ...takeHome().session, status: "active", endedAt: null } });
    expect(html(<TakeHomeContent data={live} onRemove={remove} />)).not.toContain("Remove my answers");
  });
});

describe("end-screen links (slot)", () => {
  test("the module registers one endScreen entry", () => {
    expect(getSlotEntries("endScreen").map((entry) => entry.id)).toContain("sessions:end-link");
  });

  const endScreen = (role: "host" | "participant", store = createLiveStore(role, { presentationId: "d1", joinCode: "123456" })) =>
    renderToStaticMarkup(
      <LiveStoreProvider store={store}>
        <SlotOutlet name="endScreen" props={{ role, presentationId: "d1" }} />
      </LiveStoreProvider>
    );

  test("participants get their results page, host gets the session reports", () => {
    expect(endScreen("participant")).toContain('href="/live/123456/summary"');
    expect(endScreen("participant")).toContain("See my results");
    expect(endScreen("host")).toContain('href="/presentations/d1/sessions"');
    expect(endScreen("host")).toContain("Session report");
  });

  test("the participant link pins the session once the server told the client", () => {
    const store = createLiveStore("participant", {
      presentationId: "d1",
      joinCode: "123456",
      me: { sessionId: "6ad5d9312eac91a3ea9e5ecb" } as never,
    });
    expect(endScreen("participant", store)).toContain("/live/123456/summary?sid=6ad5d9312eac91a3ea9e5ecb");
  });

  test("without a join code there is no participant link", () => {
    expect(endScreen("participant", createLiveStore("participant", { presentationId: "d1" }))).not.toContain("summary");
  });
});

describe("sessions API client", () => {
  const spies: { mockRestore: () => void }[] = [];
  afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

  test("list and report hit the sessions routes with the deck, cursor and limit", async () => {
    const get = spyOn(apiClient, "get").mockResolvedValue({ data: { data: { items: [] } } });
    spies.push(get);
    await listSessions("d1");
    await listSessions("d1", "cur", 5);
    await getSessionReport("s1");
    expect(get.mock.calls[0]).toEqual(["/sessions", { params: { presentationId: "d1", limit: 20 } }]);
    expect(get.mock.calls[1]).toEqual(["/sessions", { params: { presentationId: "d1", limit: 5, cursor: "cur" } }]);
    expect(get.mock.calls[2]![0]).toBe("/sessions/s1");
  });

  test("share, unshare and delete use the documented verbs", async () => {
    const post = spyOn(apiClient, "post").mockResolvedValue({ data: { data: { token: "t" } } });
    const del = spyOn(apiClient, "delete").mockResolvedValue({ data: { data: null } });
    spies.push(post, del);
    await enableShare("s1", { includeNames: true, expiresAt: null });
    await disableShare("s1");
    await deleteSession("s1");
    expect(post).toHaveBeenCalledWith("/sessions/s1/share", { includeNames: true, expiresAt: null });
    expect(del.mock.calls.map((call) => call[0])).toEqual(["/sessions/s1/share", "/sessions/s1"]);
  });

  test("the download file name comes from Content-Disposition", () => {
    expect(fileNameFromDisposition('attachment; filename="deck-run-1.csv"', "x.csv")).toBe("deck-run-1.csv");
    expect(fileNameFromDisposition("attachment; filename=plain.pdf", "x.pdf")).toBe("plain.pdf");
    expect(fileNameFromDisposition(undefined, "fallback.xlsx")).toBe("fallback.xlsx");
    expect(fileNameFromDisposition("attachment", "fallback.xlsx")).toBe("fallback.xlsx");
  });

  test("a failed export's blob body yields the server's message and code", async () => {
    const body = new Blob([JSON.stringify({ success: false, message: "Your plan does not include this feature", code: "FEATURE_NOT_IN_PLAN" })]);
    const err = new AxiosError("denied", "403", undefined, undefined, { status: 403, data: body } as AxiosResponse);
    expect(await readBlobError(err)).toEqual({ message: "Your plan does not include this feature", code: "FEATURE_NOT_IN_PLAN" });
    expect(await readBlobError(new Error("network"))).toBeNull();
    const garbage = new AxiosError("x", "500", undefined, undefined, { status: 500, data: new Blob(["<html>"]) } as AxiosResponse);
    expect(await readBlobError(garbage)).toBeNull();
    expect(axios.isAxiosError(err)).toBe(true);
  });
});
