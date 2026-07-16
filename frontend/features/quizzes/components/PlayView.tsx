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
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getParticipantState,
  getQuizByCode,
  joinQuiz,
  submitAnswer,
} from "../api/quizApi";
import { useQuizSocket } from "../hooks/useQuizSocket";
import { useCountdown } from "../hooks/useCountdown";
import { QuizTimer } from "./QuizTimer";
import { Leaderboard } from "./Leaderboard";
import type {
  LeaderboardEntry,
  LiveSlide,
  ParticipantState,
  PublicQuizInfo,
  QuizRealtimeEvent,
  QuizStatus,
} from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

const OPTION_COLORS = [
  "bg-red-500/15 border-red-500/30 hover:bg-red-500/25 text-red-100",
  "bg-blue-500/15 border-blue-500/30 hover:bg-blue-500/25 text-blue-100",
  "bg-yellow-500/15 border-yellow-500/30 hover:bg-yellow-500/25 text-yellow-100",
  "bg-emerald-500/15 border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-100",
  "bg-purple-500/15 border-purple-500/30 hover:bg-purple-500/25 text-purple-100",
  "bg-orange-500/15 border-orange-500/30 hover:bg-orange-500/25 text-orange-100",
  "bg-pink-500/15 border-pink-500/30 hover:bg-pink-500/25 text-pink-100",
  "bg-cyan-500/15 border-cyan-500/30 hover:bg-cyan-500/25 text-cyan-100",
];

interface PlayViewProps {
  code: string;
}

export function PlayView({ code }: PlayViewProps) {
  const [info, setInfo] = useState<PublicQuizInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [participant, setParticipant] = useState<{
    participantId: string;
    name: string;
    token: string;
  } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [joining, setJoining] = useState(false);

  const [status, setStatus] = useState<QuizStatus>("lobby");
  const [slide, setSlide] = useState<LiveSlide | null>(null);
  const [timing, setTiming] = useState<{ endsAt: string; serverNow: string } | null>(null);
  const [answeredSlide, setAnsweredSlide] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  // Per-type input state (wordcloud / scales / ranking)
  const [entries, setEntries] = useState<string[]>([]);
  const [entryDraft, setEntryDraft] = useState("");
  const [ratings, setRatings] = useState<number[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [myState, setMyState] = useState<ParticipantState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const initInputs = (next: LiveSlide) => {
    setTextDraft("");
    setEntryDraft("");
    setEntries([]);
    setRatings((next.statements ?? []).map(() => Math.ceil((next.scaleMax || 5) / 2)));
    setOrder((next.items ?? []).map((_, i) => i));
  };

  // Initial fetch by join code
  useEffect(() => {
    void (async () => {
      try {
        const data = await getQuizByCode(code);
        setInfo(data);
        setStatus(data.status);
        if (data.currentSlide && data.questionEndsAt) {
          setSlide(data.currentSlide);
          initInputs(data.currentSlide);
          setTiming({ endsAt: data.questionEndsAt, serverNow: data.serverNow });
        }
      } catch {
        setNotFound(true);
      }
    })();
  }, [code]);

  // Restore participant after refresh
  useEffect(() => {
    if (!info) return;
    const stored = localStorage.getItem(`openpoll_quiz_participant_${info.quizId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Older sessions without a token can't answer — force a fresh join
        if (parsed?.participantId && parsed?.token) setParticipant(parsed);
      } catch {
        // ignore corrupt state
      }
    }
  }, [info]);

  const quizId = info?.quizId;

  useQuizSocket(quizId, (event: QuizRealtimeEvent) => {
    switch (event.type) {
      case "question:started": {
        const payload = event.payload as unknown as {
          slide: LiveSlide;
          endsAt: string;
          serverNow: string;
        };
        setSlide(payload.slide);
        setTiming({ endsAt: payload.endsAt, serverNow: payload.serverNow });
        setStatus("question");
        initInputs(payload.slide);
        setMyState(null);
        break;
      }
      case "question:revealed": {
        setStatus("reveal");
        if (participant && quizId) {
          void getParticipantState(quizId, participant.participantId, participant.token)
            .then(setMyState)
            .catch(() => {});
        }
        break;
      }
      case "leaderboard:shown": {
        setLeaderboard((event.payload as { leaderboard: LeaderboardEntry[] }).leaderboard);
        setStatus("leaderboard");
        break;
      }
      case "quiz:ended": {
        setLeaderboard((event.payload as { leaderboard: LeaderboardEntry[] }).leaderboard);
        setStatus("ended");
        if (participant && quizId) {
          void getParticipantState(quizId, participant.participantId, participant.token)
            .then(setMyState)
            .catch(() => {});
        }
        break;
      }
      case "lobby:opened": {
        // Host restarted the session — previous participants were wiped
        setStatus("lobby");
        setSlide(null);
        setMyState(null);
        setAnsweredSlide(null);
        if (quizId) localStorage.removeItem(`openpoll_quiz_participant_${quizId}`);
        setParticipant(null);
        break;
      }
    }
  });

  const countdown = useCountdown(timing?.endsAt, timing?.serverNow, slide?.timeLimit ?? 0);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info) return;
    const name = nameDraft.trim();
    if (!name) {
      toast.error("Pick a nickname first.");
      return;
    }
    setJoining(true);
    try {
      // Present the server-signed device token from any previous join so a
      // refresh rejoins as the same participant.
      const deviceToken =
        localStorage.getItem(`openpoll_quiz_device_${info.quizId}`) ?? undefined;
      const joined = await joinQuiz(info.quizId, name, deviceToken);
      const stored = {
        participantId: joined.participantId,
        name: joined.name,
        token: joined.token,
      };
      localStorage.setItem(`openpoll_quiz_participant_${info.quizId}`, JSON.stringify(stored));
      if (joined.deviceToken) {
        localStorage.setItem(`openpoll_quiz_device_${info.quizId}`, joined.deviceToken);
      }
      setParticipant(stored);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not join the quiz.");
    } finally {
      setJoining(false);
    }
  };

  const sendAnswer = async (payload: {
    optionIndex?: number;
    text?: string;
    entries?: string[];
    ratings?: number[];
    ranking?: number[];
  }) => {
    if (!quizId || !participant || !slide || submitting) return;
    setSubmitting(true);
    try {
      await submitAnswer(quizId, {
        participantId: participant.participantId,
        participantToken: participant.token,
        slideIndex: slide.slideIndex,
        ...payload,
      });
      setAnsweredSlide(slide.slideIndex);
    } catch (err: any) {
      const message = err?.response?.data?.message || "Answer not accepted.";
      if (err?.response?.status === 409) setAnsweredSlide(slide.slideIndex);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Render guards ----------

  if (notFound) {
    return (
      <Shell>
        <div className="text-center space-y-3">
          <XCircle className="size-10 text-red-400/70 mx-auto" />
          <h1 className="text-2xl font-bold">No quiz found</h1>
          <p className="text-sm text-muted-foreground/60">
            That code doesn&apos;t match any live quiz. Double-check it with your host.
          </p>
        </div>
      </Shell>
    );
  }

  if (!info) {
    return (
      <Shell>
        <Loader2 className="size-6 animate-spin text-primary/60" />
      </Shell>
    );
  }

  // Nickname gate
  if (!participant) {
    return (
      <Shell>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="w-full max-w-sm space-y-6 text-center"
        >
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
              You&apos;re joining
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{info.title}</h1>
          </div>
          <form onSubmit={handleJoin} className="space-y-3">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Your nickname"
              maxLength={30}
              autoFocus
              className="h-12 rounded-2xl bg-secondary/15 border-border/40 text-center text-lg font-semibold"
            />
            <Button
              type="submit"
              disabled={joining}
              className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold text-base"
            >
              {joining ? <Loader2 className="size-4 animate-spin" /> : <>Join quiz <Zap className="size-4 ml-2" /></>}
            </Button>
          </form>
        </motion.div>
      </Shell>
    );
  }

  const hasAnswered = slide !== null && answeredSlide === slide.slideIndex;

  return (
    <Shell footer={`Playing as ${participant.name}`}>
      <AnimatePresence mode="wait">
        {/* ---------- LOBBY ---------- */}
        {status === "lobby" && (
          <Phase key="lobby">
            <div className="text-center space-y-4">
              <div className="size-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto animate-pulse">
                <Hourglass className="size-6 text-primary" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">You&apos;re in!</h1>
              <p className="text-sm text-muted-foreground/60">
                Waiting for the host to start <span className="text-foreground/80">{info.title}</span>…
              </p>
            </div>
          </Phase>
        )}

        {/* ---------- QUESTION ---------- */}
        {status === "question" && slide && (
          <Phase key={`q-${slide.slideIndex}`}>
            <div className="w-full max-w-md space-y-6">
              <div className="space-y-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                  Question {slide.slideIndex + 1} of {slide.totalSlides}
                </p>
                <h1 className="text-xl font-bold tracking-tight leading-snug">{slide.question}</h1>
              </div>

              <QuizTimer secondsLeft={countdown.secondsLeft} progress={countdown.progress} />

              {hasAnswered ? (
                <div className="text-center space-y-3 py-6">
                  <CheckCircle2 className="size-10 text-emerald-400 mx-auto" />
                  <p className="text-sm font-semibold text-foreground/80">Answer locked in!</p>
                  <p className="text-xs text-muted-foreground/50">
                    Waiting for the reveal — faster answers earn more points.
                  </p>
                </div>
              ) : countdown.expired ? (
                <div className="text-center space-y-3 py-6">
                  <Hourglass className="size-10 text-muted-foreground/40 mx-auto" />
                  <p className="text-sm font-semibold text-foreground/70">Time&apos;s up!</p>
                </div>
              ) : slide.type === "select_answer" ? (
                <div className="grid grid-cols-1 gap-2.5">
                  {slide.options.map((option, i) => (
                    <button
                      key={i}
                      disabled={submitting}
                      onClick={() => void sendAnswer({ optionIndex: i })}
                      className={`rounded-2xl border px-5 py-4 text-left text-base font-semibold transition-all duration-300 active:scale-[0.98] ${OPTION_COLORS[i % OPTION_COLORS.length]}`}
                    >
                      <span className="opacity-60 mr-3 font-bold">{String.fromCharCode(65 + i)}</span>
                      {option.text}
                    </button>
                  ))}
                </div>
              ) : slide.type === "wordcloud" ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 justify-center min-h-8">
                    {entries.map((entry, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-3 py-1.5 text-sm font-semibold text-primary"
                      >
                        {entry}
                        <button
                          onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                          className="hover:text-red-400 transition-colors"
                        >
                          <XCircle className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  {entries.length < slide.maxEntries && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = entryDraft.trim();
                        if (!value) return;
                        if (entries.some((x) => x.toLowerCase() === value.toLowerCase())) {
                          setEntryDraft("");
                          return;
                        }
                        setEntries((prev) => [...prev, value]);
                        setEntryDraft("");
                      }}
                      className="flex gap-2"
                    >
                      <Input
                        value={entryDraft}
                        onChange={(e) => setEntryDraft(e.target.value)}
                        placeholder={`Word ${entries.length + 1} of ${slide.maxEntries}…`}
                        maxLength={60}
                        autoFocus
                        className="h-12 rounded-2xl bg-secondary/15 border-border/40 text-center text-lg font-semibold"
                      />
                      <Button type="submit" variant="outline" className="h-12 rounded-2xl px-4">
                        Add
                      </Button>
                    </form>
                  )}
                  <Button
                    onClick={() => {
                      const draft = entryDraft.trim();
                      const all =
                        draft && !entries.some((x) => x.toLowerCase() === draft.toLowerCase())
                          ? [...entries, draft]
                          : entries;
                      if (all.length > 0) void sendAnswer({ entries: all.slice(0, slide.maxEntries) });
                    }}
                    disabled={submitting || (entries.length === 0 && !entryDraft.trim())}
                    className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : <>Send words <Send className="size-4 ml-2" /></>}
                  </Button>
                </div>
              ) : slide.type === "scales" ? (
                <div className="space-y-5">
                  {slide.statements.map((statement, i) => (
                    <div key={i} className="space-y-2">
                      <p className="text-sm font-semibold text-foreground/85">{statement}</p>
                      <input
                        type="range"
                        min={1}
                        max={slide.scaleMax}
                        step={1}
                        value={ratings[i] ?? 1}
                        onChange={(e) =>
                          setRatings((prev) =>
                            prev.map((r, j) => (j === i ? Number(e.target.value) : r))
                          )
                        }
                        className="w-full accent-primary"
                      />
                      <div className="flex justify-between text-[10px] font-medium text-muted-foreground/50">
                        <span>{slide.minLabel || "1"}</span>
                        <span className="font-bold text-primary tabular-nums">{ratings[i] ?? 1}</span>
                        <span>{slide.maxLabel || String(slide.scaleMax)}</span>
                      </div>
                    </div>
                  ))}
                  <Button
                    onClick={() => void sendAnswer({ ratings })}
                    disabled={submitting}
                    className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : <>Submit ratings <Send className="size-4 ml-2" /></>}
                  </Button>
                </div>
              ) : slide.type === "ranking" ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {order.map((itemIndex, position) => (
                      <div
                        key={itemIndex}
                        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                      >
                        <span className="text-xs font-bold text-primary/70 tabular-nums w-5">
                          {position + 1}
                        </span>
                        <span className="flex-1 text-sm font-semibold text-foreground/85">
                          {slide.items[itemIndex]}
                        </span>
                        <button
                          disabled={position === 0}
                          onClick={() =>
                            setOrder((prev) => {
                              const next = [...prev];
                              [next[position - 1], next[position]] = [next[position], next[position - 1]];
                              return next;
                            })
                          }
                          className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-foreground/60 disabled:opacity-20 hover:bg-white/10 transition-all"
                        >
                          <ChevronUp className="size-4" />
                        </button>
                        <button
                          disabled={position === order.length - 1}
                          onClick={() =>
                            setOrder((prev) => {
                              const next = [...prev];
                              [next[position], next[position + 1]] = [next[position + 1], next[position]];
                              return next;
                            })
                          }
                          className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-foreground/60 disabled:opacity-20 hover:bg-white/10 transition-all"
                        >
                          <ChevronDown className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => void sendAnswer({ ranking: order })}
                    disabled={submitting}
                    className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : <>Submit ranking <Send className="size-4 ml-2" /></>}
                  </Button>
                </div>
              ) : (
                // type_answer + open_ended share the typed-response form
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (textDraft.trim()) void sendAnswer({ text: textDraft.trim() });
                  }}
                  className="space-y-3"
                >
                  {slide.type === "open_ended" ? (
                    <Textarea
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                      placeholder="Share your thoughts…"
                      maxLength={500}
                      autoFocus
                      className="min-h-28 rounded-2xl bg-secondary/15 border-border/40 text-base"
                    />
                  ) : (
                    <Input
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                      placeholder="Type your answer…"
                      maxLength={200}
                      autoFocus
                      className="h-12 rounded-2xl bg-secondary/15 border-border/40 text-center text-lg font-semibold"
                    />
                  )}
                  <Button
                    type="submit"
                    disabled={submitting || !textDraft.trim()}
                    className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : <>Submit <Send className="size-4 ml-2" /></>}
                  </Button>
                </form>
              )}
            </div>
          </Phase>
        )}

        {/* ---------- REVEAL (personal result) ---------- */}
        {status === "reveal" && (
          <Phase key="reveal">
            <div className="text-center space-y-5 w-full max-w-sm">
              {myState?.lastAnswer ? (
                !myState.lastAnswer.scored ? (
                  <>
                    <motion.div
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    >
                      <CheckCircle2 className="size-14 text-sky-400 mx-auto" />
                    </motion.div>
                    <h1 className="text-2xl font-bold text-sky-400">Response received!</h1>
                    <p className="text-sm text-muted-foreground/60">
                      Watch the big screen for the combined results.
                    </p>
                  </>
                ) : myState.lastAnswer.isCorrect ? (
                  <>
                    <motion.div
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    >
                      <CheckCircle2 className="size-14 text-emerald-400 mx-auto" />
                    </motion.div>
                    <h1 className="text-2xl font-bold text-emerald-400">Correct!</h1>
                    <p className="text-4xl font-black text-primary tabular-nums">
                      +{myState.lastAnswer.score.toLocaleString()}
                    </p>
                  </>
                ) : (
                  <>
                    <XCircle className="size-14 text-red-400 mx-auto" />
                    <h1 className="text-2xl font-bold text-red-400">Not quite…</h1>
                    <p className="text-sm text-muted-foreground/60">No points this round.</p>
                  </>
                )
              ) : (
                <>
                  <Hourglass className="size-12 text-muted-foreground/40 mx-auto" />
                  <h1 className="text-xl font-bold text-foreground/70">
                    {myState ? "No answer this round" : "Checking your result…"}
                  </h1>
                </>
              )}
              {myState && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60">
                    Rank <span className="font-bold text-foreground/90">#{myState.rank}</span>
                  </span>
                  <span className="font-bold text-primary tabular-nums">
                    {myState.totalScore.toLocaleString()} pts
                  </span>
                </div>
              )}
            </div>
          </Phase>
        )}

        {/* ---------- LEADERBOARD ---------- */}
        {status === "leaderboard" && (
          <Phase key="leaderboard">
            <div className="w-full max-w-sm">
              <Leaderboard
                entries={leaderboard}
                highlightParticipantId={participant.participantId}
                title="Standings"
              />
            </div>
          </Phase>
        )}

        {/* ---------- ENDED ---------- */}
        {status === "ended" && (
          <Phase key="ended">
            <div className="w-full max-w-sm space-y-6 text-center">
              <div className="space-y-2">
                <PartyPopper className="size-10 text-primary mx-auto" />
                <h1 className="text-2xl font-bold tracking-tight">That&apos;s a wrap!</h1>
                {myState && (
                  <p className="text-sm text-muted-foreground/60">
                    You finished <span className="font-bold text-primary">#{myState.rank}</span> with{" "}
                    <span className="font-bold text-primary tabular-nums">
                      {myState.totalScore.toLocaleString()}
                    </span>{" "}
                    points ({myState.correctCount} correct).
                  </p>
                )}
              </div>
              <Leaderboard
                entries={leaderboard}
                highlightParticipantId={participant.participantId}
                title="Final standings"
              />
            </div>
          </Phase>
        )}
      </AnimatePresence>
    </Shell>
  );
}

function Shell({ children, footer }: { children: React.ReactNode; footer?: string }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-primary/[0.04] blur-[120px] rounded-full" />
      </div>
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-8">
        {children}
      </main>
      <footer className="relative z-10 text-center py-4 text-[10px] font-medium text-muted-foreground/30 uppercase tracking-widest flex items-center justify-center gap-2">
        {footer && (
          <>
            <Trophy className="size-3 text-primary/40" />
            <span>{footer}</span>
            <span className="opacity-40">·</span>
          </>
        )}
        Powered by Open Poll
      </footer>
    </div>
  );
}

function Phase({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.5, ease }}
      className="w-full flex justify-center"
    >
      {children}
    </motion.div>
  );
}
