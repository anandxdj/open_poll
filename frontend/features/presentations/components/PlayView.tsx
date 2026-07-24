"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Hourglass,
  Loader2,
  PartyPopper,
  Send,
  Trophy,
  XCircle,
  Presentation as PresentationIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getParticipantState,
  getPresentationByCode,
  joinPresentation,
  submitAnswer,
} from "../api/presentationApi";
import { usePresentationSocket } from "../hooks/usePresentationSocket";
import { useCountdown } from "../hooks/useCountdown";
import { PresentationTimer } from "./PresentationTimer";
import { Leaderboard } from "./Leaderboard";
import type {
  LeaderboardEntry,
  LiveSlide,
  ParticipantState,
  PublicPresentationInfo,
  PresentationRealtimeEvent,
  PresentationStatus,
} from "../types";

const ease = [0.32, 0.72, 0, 1] as const;



interface PlayViewProps {
  code: string;
}

export function PlayView({ code }: PlayViewProps) {
  const [info, setInfo] = useState<PublicPresentationInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  // Participant session (stored in localStorage per code)
  const [nameInput, setNameInput] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Live question state
  const [currentSlide, setCurrentSlide] = useState<LiveSlide | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
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

  const storageKey = `openpoll_participant_${code}`;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.participantId && parsed.token && parsed.name) {
          setParticipantId(parsed.participantId);
          setToken(parsed.token);
          setParticipantName(parsed.name);
        }
      }
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await getPresentationByCode(code);
        setInfo(data);
        if (data.currentSlide) {
          setCurrentSlide(data.currentSlide);
          setStartedAt(data.questionStartedAt ?? null);
          setEndsAt(data.questionEndsAt ?? null);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  usePresentationSocket(
    info?.presentationId || info?.quizId,
    (event: PresentationRealtimeEvent) => {
      switch (event.type) {
        case "lobby:opened": {
          setInfo((prev) => (prev ? { ...prev, status: "lobby", currentSlideIndex: -1 } : prev));
          setCurrentSlide(null);
          setSubmittedSlideIndex(null);
          break;
        }
        case "question:started": {
          const payload = event.payload as {
            slide: LiveSlide;
            startedAt: string;
            endsAt: string;
          };
          setCurrentSlide(payload.slide);
          setStartedAt(payload.startedAt);
          setEndsAt(payload.endsAt);
          setInfo((prev) =>
            prev
              ? {
                  ...prev,
                  status: "question",
                  currentSlideIndex: payload.slide.slideIndex,
                }
              : prev
          );
          // Reset form state for new question
          setSelectedOption(null);
          setTypedText("");
          setWordCloudEntries([]);
          setEntryDraft("");
          if (payload.slide.type === "scales") {
            setRatings(new Array(payload.slide.statements.length).fill(Math.ceil(payload.slide.scaleMax / 2)));
          }
          if (payload.slide.type === "ranking") {
            setRankingOrder(payload.slide.items.map((_, i) => i));
          }
          break;
        }
        case "question:revealed": {
          setInfo((prev) => (prev ? { ...prev, status: "reveal" } : prev));
          void fetchMeState();
          break;
        }
        case "leaderboard:shown": {
          const payload = event.payload as { leaderboard: LeaderboardEntry[] };
          setInfo((prev) => (prev ? { ...prev, status: "leaderboard" } : prev));
          if (payload.leaderboard) setEndLeaderboard(payload.leaderboard);
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
    }
  );

  const fetchMeState = async () => {
    const presentationId = info?.presentationId || info?.quizId;
    if (!presentationId || !participantId || !token) return;
    try {
      const state = await getParticipantState(presentationId, participantId, token);
      setMeState(state);
    } catch {}
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const presentationId = info?.presentationId || info?.quizId;
    if (!presentationId) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      toast.error("Please enter a nickname.");
      return;
    }

    let existingDeviceToken: string | undefined;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) existingDeviceToken = JSON.parse(stored).deviceToken;
    } catch {}

    setJoining(true);
    try {
      const self = await joinPresentation(presentationId, trimmed, existingDeviceToken);
      setParticipantId(self.participantId);
      setParticipantName(self.name);
      setToken(self.token);
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          participantId: self.participantId,
          token: self.token,
          name: self.name,
          deviceToken: self.deviceToken,
        })
      );
      toast.success(`Welcome, ${self.name}!`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not join presentation.");
    } finally {
      setJoining(false);
    }
  };

  const targetMs = endsAt ? new Date(endsAt).getTime() : null;
  const { secondsLeft, progress, expired } = useCountdown(
    targetMs,
    info?.serverNow,
    currentSlide?.timeLimit ?? 30
  );

  const doSubmit = async (payload: {
    optionIndex?: number;
    text?: string;
    entries?: string[];
    ratings?: number[];
    ranking?: number[];
  }) => {
    const presentationId = info?.presentationId || info?.quizId;
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
      toast.success("Answer sent!");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not submit answer.");
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

        {info.status === "question" && currentSlide && (
          <div className="w-full space-y-6">
            <PresentationTimer secondsLeft={secondsLeft} progress={progress} />
            <div className="space-y-2 text-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                Slide {currentSlide.slideIndex + 1} of {currentSlide.totalSlides}
              </span>
              <h2 className="text-xl font-bold">{currentSlide.question}</h2>
            </div>

            {hasAnswered ? (
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
              <div className="space-y-3">
                {currentSlide.type === "select_answer" && (
                  <div className="grid grid-cols-1 gap-2.5">
                    {currentSlide.options.map((opt, i) => {
                      const isSelected = selectedOption === i;
                      return (
                        <button
                          key={i}
                          onClick={() => {
                            setSelectedOption(i);
                            void doSubmit({ optionIndex: i });
                          }}
                          disabled={submitting || submittedSlideIndex === currentSlide.slideIndex}
                          className={`group relative flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left font-semibold transition-all duration-300 active:scale-[0.98] ${
                            isSelected
                              ? "border-primary/60 bg-primary/10 text-foreground shadow-[0_0_20px_rgba(216,173,135,0.12)]"
                              : "border-border bg-secondary/30 hover:border-primary/40 hover:bg-secondary/60 hover:shadow-[0_0_15px_rgba(216,173,135,0.08)] text-foreground/90"
                          }`}
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div
                              className={`flex size-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-all duration-300 ${
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                  : "border-border bg-secondary text-muted-foreground/70 group-hover:border-primary/40 group-hover:text-foreground"
                              }`}
                            >
                              {String.fromCharCode(65 + i)}
                            </div>
                            <span className="text-base font-semibold leading-snug break-words">
                              {opt.text}
                            </span>
                          </div>
                          {isSelected && (
                            <motion.div
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ type: "spring", stiffness: 400, damping: 25 }}
                            >
                              <CheckCircle2 className="size-5 shrink-0 text-primary" />
                            </motion.div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentSlide.type === "type_answer" && (
                  <div className="space-y-3">
                    <Input
                      value={typedText}
                      onChange={(e) => setTypedText(e.target.value)}
                      placeholder="Type your answer…"
                      className="h-12 rounded-xl text-center font-bold"
                    />
                    <Button
                      onClick={() => void doSubmit({ text: typedText })}
                      disabled={submitting || !typedText.trim()}
                      className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
                    >
                      Submit Answer
                    </Button>
                  </div>
                )}

                {currentSlide.type === "open_ended" && (
                  <div className="space-y-3">
                    <Textarea
                      value={typedText}
                      onChange={(e) => setTypedText(e.target.value)}
                      placeholder="Share your thoughts…"
                      maxLength={500}
                      className="min-h-28 rounded-xl text-base"
                    />
                    <Button
                      onClick={() => void doSubmit({ text: typedText.trim() })}
                      disabled={submitting || !typedText.trim()}
                      className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
                    >
                      Submit
                    </Button>
                  </div>
                )}

                {currentSlide.type === "wordcloud" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2 justify-center min-h-8">
                      {wordCloudEntries.map((entry, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-3 py-1.5 text-sm font-semibold text-primary"
                        >
                          {entry}
                          <button
                            onClick={() =>
                              setWordCloudEntries((prev) => prev.filter((_, j) => j !== i))
                            }
                            className="hover:text-red-400 transition-colors"
                          >
                            <XCircle className="size-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                    {wordCloudEntries.length < currentSlide.maxEntries && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const value = entryDraft.trim();
                          if (!value) return;
                          if (wordCloudEntries.some((x) => x.toLowerCase() === value.toLowerCase())) {
                            setEntryDraft("");
                            return;
                          }
                          setWordCloudEntries((prev) => [...prev, value]);
                          setEntryDraft("");
                        }}
                        className="flex gap-2"
                      >
                        <Input
                          value={entryDraft}
                          onChange={(e) => setEntryDraft(e.target.value)}
                          placeholder={`Word ${wordCloudEntries.length + 1} of ${currentSlide.maxEntries}…`}
                          maxLength={60}
                          className="h-12 rounded-xl text-center font-bold"
                        />
                        <Button type="submit" variant="outline" className="h-12 rounded-xl px-4">
                          Add
                        </Button>
                      </form>
                    )}
                    <Button
                      onClick={() => {
                        const draft = entryDraft.trim();
                        const all =
                          draft && !wordCloudEntries.some((x) => x.toLowerCase() === draft.toLowerCase())
                            ? [...wordCloudEntries, draft]
                            : wordCloudEntries;
                        if (all.length > 0)
                          void doSubmit({ entries: all.slice(0, currentSlide.maxEntries) });
                      }}
                      disabled={submitting || (wordCloudEntries.length === 0 && !entryDraft.trim())}
                      className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
                    >
                      {submitting ? <Loader2 className="size-4 animate-spin" /> : <>Send words <Send className="size-4 ml-2" /></>}
                    </Button>
                  </div>
                )}

                {currentSlide.type === "scales" && (
                  <div className="space-y-5">
                    {currentSlide.statements.map((statement, i) => (
                      <div key={i} className="space-y-2">
                        <p className="text-sm font-semibold">{statement}</p>
                        <input
                          type="range"
                          min={1}
                          max={currentSlide.scaleMax}
                          step={1}
                          value={ratings[i] ?? 1}
                          onChange={(e) =>
                            setRatings((prev) =>
                              prev.map((r, j) => (j === i ? Number(e.target.value) : r))
                            )
                          }
                          className="w-full accent-primary"
                        />
                        <div className="flex justify-between text-[10px] font-medium text-muted-foreground">
                          <span>{currentSlide.minLabel || "1"}</span>
                          <span className="font-bold text-primary tabular-nums">{ratings[i] ?? 1}</span>
                          <span>{currentSlide.maxLabel || String(currentSlide.scaleMax)}</span>
                        </div>
                      </div>
                    ))}
                    <Button
                      onClick={() => void doSubmit({ ratings })}
                      disabled={submitting}
                      className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
                    >
                      {submitting ? <Loader2 className="size-4 animate-spin" /> : <>Submit ratings <Send className="size-4 ml-2" /></>}
                    </Button>
                  </div>
                )}

                {currentSlide.type === "ranking" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      {rankingOrder.map((itemIndex, position) => (
                        <div
                          key={itemIndex}
                          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                        >
                          <span className="text-xs font-bold text-primary/70 tabular-nums w-5">
                            {position + 1}
                          </span>
                          <span className="flex-1 text-sm font-semibold">
                            {currentSlide.items[itemIndex]}
                          </span>
                          <button
                            disabled={position === 0}
                            onClick={() =>
                              setRankingOrder((prev) => {
                                const next = [...prev];
                                [next[position - 1], next[position]] = [next[position], next[position - 1]];
                                return next;
                              })
                            }
                            className="flex size-8 items-center justify-center rounded-lg border border-white/10 disabled:opacity-20 hover:bg-white/10 transition-all"
                          >
                            <ChevronUp className="size-4" />
                          </button>
                          <button
                            disabled={position === rankingOrder.length - 1}
                            onClick={() =>
                              setRankingOrder((prev) => {
                                const next = [...prev];
                                [next[position], next[position + 1]] = [next[position + 1], next[position]];
                                return next;
                              })
                            }
                            className="flex size-8 items-center justify-center rounded-lg border border-white/10 disabled:opacity-20 hover:bg-white/10 transition-all"
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <Button
                      onClick={() => void doSubmit({ ranking: rankingOrder })}
                      disabled={submitting}
                      className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold"
                    >
                      {submitting ? <Loader2 className="size-4 animate-spin" /> : <>Submit ranking <Send className="size-4 ml-2" /></>}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {info.status === "reveal" && (
          <div className="text-center space-y-5 w-full max-w-sm">
            {meState?.lastAnswer ? (
              !meState.lastAnswer.scored ? (
                <>
                  <CheckCircle2 className="size-14 text-sky-400 mx-auto" />
                  <h2 className="text-2xl font-bold text-sky-400">Response received!</h2>
                  <p className="text-sm text-muted-foreground">
                    Watch the big screen for the combined results.
                  </p>
                </>
              ) : meState.lastAnswer.isCorrect ? (
                <>
                  <CheckCircle2 className="size-14 text-emerald-400 mx-auto" />
                  <h2 className="text-2xl font-bold text-emerald-400">Correct!</h2>
                  <p className="text-4xl font-black text-primary tabular-nums">
                    +{meState.lastAnswer.score.toLocaleString()}
                  </p>
                </>
              ) : (
                <>
                  <XCircle className="size-14 text-red-400 mx-auto" />
                  <h2 className="text-2xl font-bold text-red-400">Not quite…</h2>
                  <p className="text-sm text-muted-foreground">No points this round.</p>
                </>
              )
            ) : (
              <>
                <Hourglass className="size-12 text-muted-foreground/40 mx-auto" />
                <h2 className="text-xl font-bold text-foreground/70">
                  {meState ? "No answer this round" : "Checking your result…"}
                </h2>
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
          </div>
        )}

        {info.status === "leaderboard" && (
          <div className="w-full space-y-4">
            <Leaderboard entries={endLeaderboard} highlightParticipantId={participantId} />
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
