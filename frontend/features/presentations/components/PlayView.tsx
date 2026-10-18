"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Hourglass,
  Loader2,
  PartyPopper,
  Trophy,
  XCircle,
  Presentation as PresentationIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  apiErrorMessage,
  apiErrorStatus,
  getParticipantState,
  getPresentationByCode,
  joinPresentation,
  submitAnswer,
} from "../api/presentationApi";
import { usePresentationSocket } from "../hooks/usePresentationSocket";
import { useCountdown } from "../hooks/useCountdown";
import { PresentationTimer } from "./PresentationTimer";
import { Leaderboard } from "./Leaderboard";
import { SelectAnswerInput } from "./slides/participant/SelectAnswerInput";
import { TypeAnswerInput } from "./slides/participant/TypeAnswerInput";
import { WordCloudInput } from "./slides/participant/WordCloudInput";
import { OpenEndedInput } from "./slides/participant/OpenEndedInput";
import { ScalesInput } from "./slides/participant/ScalesInput";
import { RankingInput } from "./slides/participant/RankingInput";
import type {
  LeaderboardEntry,
  LiveSlide,
  ParticipantState,
  PublicPresentationInfo,
  PresentationRealtimeEvent,
  RevealPayload,
} from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

interface StoredParticipant {
  participantId: string;
  name: string;
  token: string;
}

interface StoredSession extends Partial<StoredParticipant> {
  /** Server-signed device identity, presented on rejoin after a refresh */
  deviceToken?: string;
}

const storageKeyFor = (code: string) => `openpoll_participant_${code}`;

function readSession(code: string): StoredSession {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(storageKeyFor(code)) ?? "{}") as StoredSession;
  } catch {
    return {};
  }
}

function writeSession(code: string, session: StoredSession) {
  try {
    localStorage.setItem(storageKeyFor(code), JSON.stringify(session));
  } catch {
    // Private mode / quota: the session just won't survive a refresh.
  }
}

function readParticipant(code: string): StoredParticipant | null {
  const { participantId, name, token } = readSession(code);
  return participantId && name && token ? { participantId, name, token } : null;
}

interface PlayViewProps {
  code: string;
}

export function PlayView({ code }: PlayViewProps) {
  const [info, setInfo] = useState<PublicPresentationInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  // Participant session, persisted in localStorage per join code. Read lazily:
  // the first render is the loading spinner either way, so the server/client
  // difference never reaches the markup. The page keys this view by code, so
  // a different code remounts it rather than reusing this state.
  const [nameInput, setNameInput] = useState("");
  const [participant, setParticipant] = useState<StoredParticipant | null>(() => readParticipant(code));
  const participantId = participant?.participantId ?? null;
  const participantName = participant?.name ?? null;
  const token = participant?.token ?? null;
  const [joining, setJoining] = useState(false);

  // Live question state. serverNow travels with each deadline so the countdown
  // re-syncs its clock offset per question rather than reusing the page-load one.
  const [currentSlide, setCurrentSlide] = useState<LiveSlide | null>(null);
  const [timing, setTiming] = useState<{ endsAt: string; serverNow: string } | null>(null);
  const [submittedSlideIndex, setSubmittedSlideIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form states per slide type
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [typedText, setTypedText] = useState("");
  const [wordCloudEntries, setWordCloudEntries] = useState<string[]>([]);
  const [entryDraft, setEntryDraft] = useState("");
  const [ratings, setRatings] = useState<number[]>([]);
  const [rankingOrder, setRankingOrder] = useState<number[]>([]);

  // Result / leaderboard state
  const [meState, setMeState] = useState<ParticipantState | null>(null);
  const [endLeaderboard, setEndLeaderboard] = useState<LeaderboardEntry[]>([]);
  // Reveal payload (correct answer) — arrives when host timer hits 0. Status
  // stays "active"; this drives the correct/wrong highlight.
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  // Leaderboard slide currently on screen (host advanced to a leaderboard slide).
  const [leaderboardView, setLeaderboardView] = useState<LeaderboardEntry[] | null>(null);

  // Fresh inputs for a slide. Also runs for the slide a late joiner (or a
  // refresh) lands on, or scales/ranking would submit empty answers.
  const resetInputs = (slide: LiveSlide) => {
    setSubmittedSlideIndex(null);
    setSelectedOption(null);
    setTypedText("");
    setWordCloudEntries([]);
    setEntryDraft("");
    setRatings((slide.statements ?? []).map(() => Math.ceil((slide.scaleMax || 5) / 2)));
    setRankingOrder((slide.items ?? []).map((_, i) => i));
  };

  const presentationId = info?.presentationId || info?.quizId;

  useEffect(() => {
    void (async () => {
      try {
        const data = await getPresentationByCode(code);
        setInfo(data);
        if (data.currentSlide && data.questionEndsAt) {
          setCurrentSlide(data.currentSlide);
          setTiming({ endsAt: data.questionEndsAt, serverNow: data.serverNow });
          resetInputs(data.currentSlide);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  const fetchMeState = async () => {
    if (!presentationId || !participantId || !token) return;
    try {
      setMeState(await getParticipantState(presentationId, participantId, token));
    } catch {
      // Score panel just stays as it was.
    }
  };

  usePresentationSocket(
    presentationId,
    (event: PresentationRealtimeEvent) => {
      switch (event.type) {
        case "lobby:opened": {
          // (Re)opening the lobby wipes every participant server-side, so the
          // stored credentials are dead: drop them and show the nickname gate.
          // The device token is kept so the rejoin stays one identity.
          setInfo((prev) => (prev ? { ...prev, status: "lobby", currentSlideIndex: -1 } : prev));
          setCurrentSlide(null);
          setTiming(null);
          setReveal(null);
          setLeaderboardView(null);
          setMeState(null);
          setSubmittedSlideIndex(null);
          if (participant) {
            writeSession(code, { deviceToken: readSession(code).deviceToken });
            setParticipant(null);
          }
          break;
        }
        case "question:started": {
          const payload = event.payload as {
            slide: LiveSlide;
            endsAt: string;
            serverNow: string;
          };
          setCurrentSlide(payload.slide);
          setTiming({ endsAt: payload.endsAt, serverNow: payload.serverNow });
          setReveal(null);
          setLeaderboardView(null);
          setMeState(null);
          setInfo((prev) =>
            prev
              ? {
                  ...prev,
                  status: "active",
                  currentSlideIndex: payload.slide.slideIndex,
                }
              : prev
          );
          resetInputs(payload.slide);
          break;
        }
        case "question:revealed": {
          // Correct answer broadcast (timer hit 0). Status stays "active".
          setReveal(event.payload as unknown as RevealPayload);
          void fetchMeState();
          break;
        }
        case "leaderboard:shown": {
          const payload = event.payload as { leaderboard: LeaderboardEntry[] };
          setCurrentSlide(null);
          setReveal(null);
          setInfo((prev) => (prev ? { ...prev, status: "active" } : prev));
          if (payload.leaderboard) setLeaderboardView(payload.leaderboard);
          void fetchMeState();
          break;
        }
        case "quiz:ended": {
          const payload = event.payload as { leaderboard: LeaderboardEntry[] };
          setInfo((prev) => (prev ? { ...prev, status: "ended" } : prev));
          if (payload.leaderboard) setEndLeaderboard(payload.leaderboard);
          void fetchMeState();
          break;
        }
      }
    },
    participantId && token ? { role: "participant", participantId, participantToken: token } : undefined
  );

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presentationId) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      toast.error("Please enter a nickname.");
      return;
    }

    setJoining(true);
    try {
      const self = await joinPresentation(presentationId, trimmed, readSession(code).deviceToken);
      const joined = { participantId: self.participantId, name: self.name, token: self.token };
      setParticipant(joined);
      writeSession(code, { ...joined, deviceToken: self.deviceToken });
      toast.success(`Welcome, ${self.name}!`);
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err) || "Could not join presentation.");
    } finally {
      setJoining(false);
    }
  };

  const { secondsLeft, progress, expired } = useCountdown(
    timing?.endsAt,
    timing?.serverNow,
    currentSlide?.timeLimit ?? 30
  );

  const doSubmit = async (payload: {
    optionIndex?: number;
    text?: string;
    entries?: string[];
    ratings?: number[];
    ranking?: number[];
  }) => {
    if (!presentationId || !participantId || !token || currentSlide === null) return;
    setSubmitting(true);
    try {
      await submitAnswer(presentationId, {
        participantId,
        participantToken: token,
        slideIndex: currentSlide.slideIndex,
        ...payload,
      });
      setSubmittedSlideIndex(currentSlide.slideIndex);
      // Fetch immediate result so scored slides can show green/red on the
      // participant's own choice right away (correct answer still hidden until reveal).
      void fetchMeState();
    } catch (err: unknown) {
      if (apiErrorStatus(err) === 409) {
        setSubmittedSlideIndex(currentSlide.slideIndex);
        void fetchMeState();
      } else {
        toast.error(apiErrorMessage(err) || "Could not submit answer.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary/60" />
      </div>
    );
  }

  if (notFound || !info) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 text-center">
        <div className="space-y-3">
          <PresentationIcon className="size-10 text-muted-foreground/40 mx-auto" />
          <h1 className="text-xl font-bold">Presentation Deck Not Found</h1>
          <p className="text-sm text-muted-foreground">Check your code and try again.</p>
        </div>
      </div>
    );
  }

  if (!participantId) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="w-full max-w-sm space-y-6 text-center"
        >
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{info.title}</h1>
            <p className="text-sm text-muted-foreground">Choose a nickname to join the deck.</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-3">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your nickname"
              autoFocus
              className="h-12 rounded-xl text-center font-bold"
            />
            <Button
              type="submit"
              disabled={joining || !nameInput.trim()}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
            >
              {joining ? <Loader2 className="size-4 animate-spin" /> : "Join Session"}
            </Button>
          </form>
        </motion.div>
      </div>
    );
  }

  const hasAnswered = currentSlide !== null && submittedSlideIndex === currentSlide.slideIndex;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="flex h-14 items-center justify-between border-b border-border/40 px-6 bg-card/50 backdrop-blur-md">
        <span className="text-xs font-bold truncate max-w-[200px]">{info.title}</span>
        <span className="text-xs font-semibold text-primary">{participantName}</span>
      </header>

      <main className="flex-1 flex flex-col justify-center items-center p-6 max-w-md mx-auto w-full">
        {info.status === "lobby" && (
          <div className="text-center space-y-4">
            <Hourglass className="size-10 text-primary animate-spin mx-auto" />
            <h2 className="text-xl font-bold">You&apos;re in!</h2>
            <p className="text-sm text-muted-foreground">Waiting for the host to start the presentation.</p>
          </div>
        )}

        {/* Leaderboard slide */}
        {leaderboardView && (
          <div className="w-full space-y-4">
            <div className="flex items-center justify-center gap-2 text-sm font-bold text-primary">
              <Trophy className="size-4" /> Leaderboard
            </div>
            <Leaderboard entries={leaderboardView} highlightParticipantId={participantId} />
          </div>
        )}

        {info.status === "active" && currentSlide && !leaderboardView && (
          <div className="w-full space-y-6">
            {!reveal && secondsLeft > 0 && (
              <PresentationTimer secondsLeft={secondsLeft} progress={progress} />
            )}
            <div className="space-y-2 text-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                Slide {currentSlide.slideIndex + 1} of {currentSlide.totalSlides}
              </span>
              <h2 className="text-xl font-bold">{currentSlide.question}</h2>
            </div>

            {/* Post-reveal feedback */}
            {reveal && hasAnswered && meState?.lastAnswer ? (
              <div className="text-center space-y-3">
                {!meState.lastAnswer.scored ? (
                  <>
                    <CheckCircle2 className="size-12 text-sky-400 mx-auto" />
                    <p className="font-bold">Response received!</p>
                  </>
                ) : meState.lastAnswer.isCorrect ? (
                  <>
                    <CheckCircle2 className="size-12 text-emerald-400 mx-auto" />
                    <p className="text-xl font-bold text-emerald-400">Correct!</p>
                    <p className="text-3xl font-black text-primary tabular-nums">
                      +{meState.lastAnswer.score.toLocaleString()}
                    </p>
                  </>
                ) : (
                  <>
                    <XCircle className="size-12 text-red-400 mx-auto" />
                    <p className="text-xl font-bold text-red-400">Not quite…</p>
                    <p className="text-sm text-muted-foreground">No points this round.</p>
                  </>
                )}
                {meState && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Rank <span className="font-bold text-foreground">#{meState.rank}</span>
                    </span>
                    <span className="font-bold text-primary tabular-nums">
                      {meState.totalScore.toLocaleString()} pts
                    </span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Waiting for host to advance…</p>
              </div>
            ) : reveal && !hasAnswered ? (
              <div className="text-center py-8 space-y-2">
                <Hourglass className="size-10 text-muted-foreground/40 mx-auto" />
                <p className="font-bold text-sm">Time&apos;s up!</p>
                <p className="text-xs text-muted-foreground">Waiting for host to advance…</p>
              </div>
            ) : hasAnswered ? (
              <div className="text-center py-8 space-y-2">
                <CheckCircle2 className="size-10 text-emerald-400 mx-auto" />
                <p className="font-bold text-sm">
                  {currentSlide.scored ? "Answer locked in!" : "Response received!"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {currentSlide.scored
                    ? "Waiting for the reveal — faster answers earn more points."
                    : "Waiting for question to close."}
                </p>
              </div>
            ) : expired ? (
              <div className="text-center py-8 space-y-2">
                <Hourglass className="size-10 text-muted-foreground/40 mx-auto" />
                <p className="font-bold text-sm">Time&apos;s up!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {currentSlide.type === "select_answer" && (
                  <SelectAnswerInput
                    options={currentSlide.options}
                    selectedOption={selectedOption}
                    onSelectOption={setSelectedOption}
                    onSubmit={() => selectedOption !== null && void doSubmit({ optionIndex: selectedOption })}
                    submitting={submitting}
                  />
                )}

                {currentSlide.type === "type_answer" && (
                  <TypeAnswerInput
                    typedText={typedText}
                    onTypedTextChange={setTypedText}
                    onSubmit={() => void doSubmit({ text: typedText })}
                    submitting={submitting}
                  />
                )}

                {currentSlide.type === "open_ended" && (
                  <OpenEndedInput
                    typedText={typedText}
                    onTypedTextChange={setTypedText}
                    onSubmit={() => void doSubmit({ text: typedText.trim() })}
                    submitting={submitting}
                  />
                )}

                {currentSlide.type === "wordcloud" && (
                  <WordCloudInput
                    entries={wordCloudEntries}
                    entryDraft={entryDraft}
                    onEntryDraftChange={setEntryDraft}
                    onAddEntry={() => {
                      const value = entryDraft.trim();
                      if (!value) return;
                      if (!wordCloudEntries.some((x) => x.toLowerCase() === value.toLowerCase())) {
                        setWordCloudEntries((prev) => [...prev, value]);
                      }
                      setEntryDraft("");
                    }}
                    onRemoveEntry={(index) =>
                      setWordCloudEntries((prev) => prev.filter((_, j) => j !== index))
                    }
                    onSubmit={() => {
                      const draft = entryDraft.trim();
                      const all =
                        draft && !wordCloudEntries.some((x) => x.toLowerCase() === draft.toLowerCase())
                          ? [...wordCloudEntries, draft]
                          : wordCloudEntries;
                      if (all.length > 0)
                        void doSubmit({ entries: all.slice(0, currentSlide.maxEntries) });
                    }}
                    maxEntries={currentSlide.maxEntries}
                    submitting={submitting}
                  />
                )}

                {currentSlide.type === "scales" && (
                  <ScalesInput
                    statements={currentSlide.statements}
                    ratings={ratings}
                    onRatingChange={(index, val) =>
                      setRatings((prev) => prev.map((r, j) => (j === index ? val : r)))
                    }
                    scaleMax={currentSlide.scaleMax}
                    minLabel={currentSlide.minLabel}
                    maxLabel={currentSlide.maxLabel}
                    onSubmit={() => void doSubmit({ ratings })}
                    submitting={submitting}
                  />
                )}

                {currentSlide.type === "ranking" && (
                  <RankingInput
                    items={currentSlide.items}
                    rankingOrder={rankingOrder}
                    onMoveItem={(from, to) =>
                      setRankingOrder((prev) => {
                        const next = [...prev];
                        [next[from], next[to]] = [next[to], next[from]];
                        return next;
                      })
                    }
                    onSubmit={() => void doSubmit({ ranking: rankingOrder })}
                    submitting={submitting}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {info.status === "ended" && (
          <div className="w-full max-w-sm space-y-6 text-center">
            <div className="space-y-2">
              <PartyPopper className="size-10 text-primary mx-auto" />
              <h2 className="text-2xl font-bold tracking-tight">That&apos;s a wrap!</h2>
              {meState && (
                <p className="text-sm text-muted-foreground">
                  You finished <span className="font-bold text-primary">#{meState.rank}</span> with{" "}
                  <span className="font-bold text-primary tabular-nums">
                    {meState.totalScore.toLocaleString()}
                  </span>{" "}
                  points ({meState.correctCount} correct).
                </p>
              )}
            </div>
            <Leaderboard
              entries={endLeaderboard}
              highlightParticipantId={participantId}
              title="Final standings"
            />
          </div>
        )}
      </main>
    </div>
  );
}
