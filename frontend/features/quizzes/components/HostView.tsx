"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  Flag,
  Loader2,
  Play,
  Radio,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import {
  endQuiz,
  getHostState,
  openLobby,
  revealAnswers,
  showLeaderboard,
  startNextQuestion,
} from "../api/quizApi";
import { useQuizSocket } from "../hooks/useQuizSocket";
import { useCountdown } from "../hooks/useCountdown";
import { QuizTimer } from "./QuizTimer";
import { Leaderboard } from "./Leaderboard";
import type {
  LeaderboardEntry,
  Quiz,
  QuizRealtimeEvent,
  RevealPayload,
} from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

interface HostViewProps {
  quizId: string;
}

export function HostView({ quizId }: HostViewProps) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [participants, setParticipants] = useState<{ participantId: string; name: string }[]>([]);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await getHostState(quizId);
      setQuiz(state.quiz);
      setServerNow(state.serverNow);
      setParticipants(state.participants);
      setAnsweredCount(state.answeredCount);
      setLeaderboard(state.leaderboard);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not load quiz.");
      router.push("/quizzes");
    } finally {
      setLoading(false);
    }
  }, [quizId, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useQuizSocket(quizId, (event: QuizRealtimeEvent) => {
    if (event.type === "participant:joined") {
      const { participantId, name } = event.payload as { participantId: string; name: string };
      setParticipants((prev) =>
        prev.some((p) => p.participantId === participantId)
          ? prev
          : [...prev, { participantId, name }]
      );
    }
    if (event.type === "answer:received") {
      setAnsweredCount((event.payload as { answeredCount: number }).answeredCount);
    }
    if (event.type === "question:revealed") {
      setReveal(event.payload as unknown as RevealPayload);
    }
    if (event.type === "leaderboard:shown" || event.type === "quiz:ended") {
      setLeaderboard((event.payload as { leaderboard: LeaderboardEntry[] }).leaderboard);
    }
  });

  const slide = useMemo(() => {
    if (!quiz || quiz.currentSlideIndex < 0) return null;
    return quiz.slides[quiz.currentSlideIndex] ?? null;
  }, [quiz]);

  const countdown = useCountdown(quiz?.questionEndsAt, serverNow, slide?.timeLimit ?? 0);

  const run = async (action: () => Promise<Quiz>, onDone?: (q: Quiz) => void) => {
    setBusy(true);
    try {
      const updated = await action();
      setQuiz(updated);
      setServerNow(new Date().toISOString());
      onDone?.(updated);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !quiz) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary/60" />
      </div>
    );
  }

  const isLastSlide = quiz.currentSlideIndex >= quiz.slides.length - 1;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const joinUrl = `${origin}/quiz/join`;
  // QR deep-links straight into the play screen with the code pre-filled
  const playUrl = `${origin}/quiz/play/${quiz.joinCode}`;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[40rem] h-72 bg-primary/[0.05] blur-[140px] rounded-full" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-400">
            <Radio className="size-3 animate-pulse" /> Live host
          </span>
          <h1 className="text-sm font-bold tracking-tight text-foreground/90 truncate max-w-md">
            {quiz.title}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5 text-primary/70" /> {participants.length}
          </span>
          {quiz.status !== "ended" && quiz.status !== "draft" && (
            <span className="font-mono font-bold text-primary tracking-[0.2em]">
              {quiz.joinCode}
            </span>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-8">
        <AnimatePresence mode="wait">
          {/* ---------- DRAFT ---------- */}
          {quiz.status === "draft" && (
            <motion.div
              key="draft"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.5, ease }}
              className="text-center space-y-6 max-w-md"
            >
              <h2 className="text-3xl font-bold tracking-tight">Ready to go live?</h2>
              <p className="text-sm text-muted-foreground/60">
                Opening the lobby lets participants join with the code. {quiz.slides.length} slide
                {quiz.slides.length !== 1 ? "s" : ""} loaded.
              </p>
              <Button
                onClick={() => run(() => openLobby(quizId))}
                disabled={busy}
                className="h-12 rounded-full bg-primary text-primary-foreground font-semibold px-8 text-base"
              >
                <Play className="size-4 mr-2" /> Open lobby
              </Button>
            </motion.div>
          )}

          {/* ---------- LOBBY ---------- */}
          {quiz.status === "lobby" && (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.5, ease }}
              className="text-center space-y-8 w-full max-w-2xl"
            >
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50">
                  Scan the QR — or join at <span className="text-foreground/80">{joinUrl}</span>{" "}
                  with code
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <div className="p-1.5 rounded-[2rem] bg-white/5 border border-white/10">
                    <div className="rounded-[calc(2rem-0.375rem)] bg-card px-10 py-6">
                      <span className="text-6xl font-black tracking-[0.3em] text-primary tabular-nums">
                        {quiz.joinCode}
                      </span>
                    </div>
                  </div>
                  <div className="p-1.5 rounded-[2rem] bg-white/5 border border-white/10">
                    <div className="rounded-[calc(2rem-0.375rem)] bg-white p-4">
                      <QRCodeSVG
                        value={playUrl}
                        size={148}
                        level="M"
                        bgColor="#ffffff"
                        fgColor="#000000"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center justify-center gap-2">
                  <Users className="size-3.5" /> {participants.length} joined
                </p>
                <div className="flex flex-wrap justify-center gap-2 max-h-40 overflow-y-auto">
                  <AnimatePresence>
                    {participants.map((p) => (
                      <motion.span
                        key={p.participantId}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3, ease }}
                        className="rounded-full bg-white/5 border border-white/10 px-3 py-1 text-xs font-medium text-foreground/80"
                      >
                        {p.name}
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              <Button
                onClick={() => {
                  setReveal(null);
                  setAnsweredCount(0);
                  void run(() => startNextQuestion(quizId));
                }}
                disabled={busy || participants.length === 0}
                className="h-12 rounded-full bg-primary text-primary-foreground font-semibold px-8 text-base"
              >
                Start quiz <ArrowRight className="size-4 ml-2" />
              </Button>
            </motion.div>
          )}

          {/* ---------- LIVE QUESTION ---------- */}
          {quiz.status === "question" && slide && (
            <motion.div
              key={`question-${quiz.currentSlideIndex}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.5, ease }}
              className="w-full max-w-3xl space-y-8"
            >
              <div className="space-y-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                  Question {quiz.currentSlideIndex + 1} of {quiz.slides.length}
                </p>
                <h2 className="text-4xl font-bold tracking-tight leading-tight">
                  {slide.question}
                </h2>
              </div>

              <QuizTimer secondsLeft={countdown.secondsLeft} progress={countdown.progress} />

              {slide.type === "select_answer" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {slide.options.map((option, i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-base font-semibold text-foreground/90"
                    >
                      <span className="text-primary/60 mr-3 font-bold">
                        {String.fromCharCode(65 + i)}
                      </span>
                      {option.text}
                    </div>
                  ))}
                </div>
              )}
              {slide.type === "type_answer" && (
                <p className="text-center text-sm text-muted-foreground/60">
                  Participants are typing their answers…
                </p>
              )}
              {slide.type === "wordcloud" && (
                <p className="text-center text-sm text-muted-foreground/60">
                  Participants are sending words — the cloud appears at reveal…
                </p>
              )}
              {slide.type === "open_ended" && (
                <p className="text-center text-sm text-muted-foreground/60">
                  Responses are coming in — revealed as a card wall…
                </p>
              )}
              {slide.type === "scales" && (
                <div className="space-y-2 max-w-xl mx-auto">
                  {slide.statements.map((statement, i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-foreground/85"
                    >
                      {statement}
                    </div>
                  ))}
                  <p className="text-center text-xs text-muted-foreground/50 pt-1">
                    Rating 1–{slide.scaleMax} · {slide.minLabel || "Low"} → {slide.maxLabel || "High"}
                  </p>
                </div>
              )}
              {slide.type === "ranking" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl mx-auto">
                  {slide.items.map((item, i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-foreground/85"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground/70 tabular-nums">
                  {answeredCount}/{participants.length} answered
                </span>
                <Button
                  onClick={() => run(() => revealAnswers(quizId))}
                  disabled={busy}
                  className={`h-11 rounded-full font-semibold px-6 ${
                    countdown.expired
                      ? "bg-primary text-primary-foreground animate-pulse"
                      : "bg-white/10 text-foreground hover:bg-white/20"
                  }`}
                >
                  <Eye className="size-4 mr-2" /> Reveal answers
                </Button>
              </div>
            </motion.div>
          )}

          {/* ---------- REVEAL ---------- */}
          {quiz.status === "reveal" && (
            <motion.div
              key={`reveal-${quiz.currentSlideIndex}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.5, ease }}
              className="w-full max-w-3xl space-y-8"
            >
              <div className="space-y-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80">
                  Results — Question {quiz.currentSlideIndex + 1}
                </p>
                <h2 className="text-3xl font-bold tracking-tight">{slide?.question}</h2>
              </div>

              {reveal ? (
                <RevealChart reveal={reveal} />
              ) : (
                <div className="flex justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-primary/60" />
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                <Button
                  onClick={() => run(() => showLeaderboard(quizId))}
                  disabled={busy}
                  variant="outline"
                  className="h-11 rounded-full px-6 font-semibold border-white/15"
                >
                  <Trophy className="size-4 mr-2" /> Show leaderboard
                </Button>
                {isLastSlide ? (
                  <Button
                    onClick={() => run(() => endQuiz(quizId))}
                    disabled={busy}
                    className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6"
                  >
                    <Flag className="size-4 mr-2" /> Final results
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setReveal(null);
                      setAnsweredCount(0);
                      void run(() => startNextQuestion(quizId));
                    }}
                    disabled={busy}
                    className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6"
                  >
                    Next question <ArrowRight className="size-4 ml-2" />
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {/* ---------- LEADERBOARD ---------- */}
          {quiz.status === "leaderboard" && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.5, ease }}
              className="w-full max-w-xl space-y-8"
            >
              <Leaderboard entries={leaderboard} title="Standings" />
              <div className="flex justify-center gap-3">
                {isLastSlide ? (
                  <Button
                    onClick={() => run(() => endQuiz(quizId))}
                    disabled={busy}
                    className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6"
                  >
                    <Flag className="size-4 mr-2" /> Final results
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setReveal(null);
                      setAnsweredCount(0);
                      void run(() => startNextQuestion(quizId));
                    }}
                    disabled={busy}
                    className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6"
                  >
                    Next question <ArrowRight className="size-4 ml-2" />
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {/* ---------- ENDED ---------- */}
          {quiz.status === "ended" && (
            <motion.div
              key="ended"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="w-full max-w-xl space-y-8 text-center"
            >
              <div className="space-y-2">
                <Trophy className="size-10 text-primary mx-auto" />
                <h2 className="text-3xl font-bold tracking-tight">Final results</h2>
              </div>
              <Leaderboard entries={leaderboard} title="Final standings" />
              <div className="flex justify-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => run(() => openLobby(quizId))}
                  disabled={busy}
                  className="h-11 rounded-full px-6 font-semibold border-white/15"
                >
                  <Play className="size-4 mr-2" /> Run again
                </Button>
                <Button
                  onClick={() => router.push("/quizzes")}
                  className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6"
                >
                  Back to quizzes
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function RevealChart({ reveal }: { reveal: RevealPayload }) {
  if (reveal.distribution.kind === "options") {
    const { counts, options } = reveal.distribution;
    const max = Math.max(...counts, 1);
    return (
      <div className="space-y-3">
        {options.map((option, i) => (
          <div
            key={i}
            className={`rounded-2xl border px-5 py-4 ${
              option.isCorrect
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                <span className="text-primary/60 font-bold">{String.fromCharCode(65 + i)}</span>
                {option.text}
                {option.isCorrect && <CheckCircle2 className="size-4 text-emerald-400" />}
              </span>
              <span className="text-sm font-bold tabular-nums text-muted-foreground/80">
                {counts[i] ?? 0}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${((counts[i] ?? 0) / max) * 100}%` }}
                transition={{ duration: 0.7, ease }}
                className={`h-full rounded-full ${option.isCorrect ? "bg-emerald-400" : "bg-primary/50"}`}
              />
            </div>
          </div>
        ))}
        <p className="text-center text-xs text-muted-foreground/50">
          {reveal.answeredCount}/{reveal.participantCount} answered
        </p>
      </div>
    );
  }

  if (reveal.distribution.kind === "text") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap justify-center gap-2">
          {reveal.distribution.answers.map((answer, i) => (
            <span
              key={i}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                answer.isCorrect
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-white/10 bg-white/[0.03] text-foreground/70"
              }`}
            >
              {answer.text} <span className="opacity-60">×{answer.count}</span>
            </span>
          ))}
          {reveal.distribution.answers.length === 0 && (
            <p className="text-sm text-muted-foreground/50">No answers were submitted.</p>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground/60">
          Accepted: {reveal.distribution.acceptedAnswers.join(", ")}
        </p>
      </div>
    );
  }

  if (reveal.distribution.kind === "words") {
    const { words } = reveal.distribution;
    const max = Math.max(...words.map((w) => w.count), 1);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 py-4 max-w-2xl mx-auto">
          {words.map((word, i) => {
            const scale = word.count / max;
            return (
              <motion.span
                key={word.text}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 0.55 + scale * 0.45, scale: 1 }}
                transition={{ duration: 0.5, ease, delay: Math.min(i * 0.03, 0.6) }}
                className={`font-extrabold tracking-tight leading-none ${WORD_COLORS[i % WORD_COLORS.length]}`}
                style={{ fontSize: `${0.9 + scale * 2.4}rem` }}
                title={`×${word.count}`}
              >
                {word.text}
              </motion.span>
            );
          })}
          {words.length === 0 && (
            <p className="text-sm text-muted-foreground/50">No words were submitted.</p>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground/50">
          {reveal.answeredCount}/{reveal.participantCount} answered
        </p>
      </div>
    );
  }

  if (reveal.distribution.kind === "responses") {
    const { responses } = reveal.distribution;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {responses.map((response, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease, delay: Math.min(i * 0.04, 0.6) }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <p className="text-sm font-medium text-foreground/85 leading-snug">
                {response.text}
              </p>
              {response.count > 1 && (
                <p className="text-[10px] font-bold text-primary/60 mt-1.5">×{response.count}</p>
              )}
            </motion.div>
          ))}
          {responses.length === 0 && (
            <p className="text-sm text-muted-foreground/50 col-span-full text-center">
              No responses were submitted.
            </p>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground/50">
          {reveal.answeredCount}/{reveal.participantCount} answered
        </p>
      </div>
    );
  }

  if (reveal.distribution.kind === "scales") {
    const { statements, scaleMax, minLabel, maxLabel } = reveal.distribution;
    return (
      <div className="space-y-3 max-w-xl mx-auto">
        {statements.map((entry, i) => (
          <div
            key={i}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground/90">{entry.statement}</span>
              <span className="text-sm font-bold tabular-nums text-primary">
                {entry.average.toFixed(1)} <span className="text-muted-foreground/50 font-medium">/ {scaleMax}</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(entry.average / scaleMax) * 100}%` }}
                transition={{ duration: 0.7, ease }}
                className="h-full rounded-full bg-violet-400"
              />
            </div>
            <div className="flex justify-between text-[10px] font-medium text-muted-foreground/40 mt-1.5">
              <span>{minLabel || "1"}</span>
              <span>{entry.count} rating{entry.count !== 1 ? "s" : ""}</span>
              <span>{maxLabel || String(scaleMax)}</span>
            </div>
          </div>
        ))}
        <p className="text-center text-xs text-muted-foreground/50">
          {reveal.answeredCount}/{reveal.participantCount} answered
        </p>
      </div>
    );
  }

  // ranking — combined order by Borda points
  const { items, voters } = reveal.distribution;
  const maxPoints = Math.max(...items.map((i) => i.points), 1);
  return (
    <div className="space-y-3 max-w-xl mx-auto">
      {items.map((item) => (
        <div
          key={item.text}
          className={`rounded-2xl border px-5 py-4 ${
            item.rank === 1
              ? "border-primary/40 bg-primary/10"
              : "border-white/10 bg-white/[0.03]"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground/90 flex items-center gap-2.5">
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs font-black tabular-nums ${
                  item.rank === 1 ? "bg-primary text-primary-foreground" : "bg-white/10 text-foreground/70"
                }`}
              >
                {item.rank}
              </span>
              {item.text}
            </span>
            <span className="text-xs font-bold tabular-nums text-muted-foreground/70">
              {item.points} pts
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(item.points / maxPoints) * 100}%` }}
              transition={{ duration: 0.7, ease }}
              className={`h-full rounded-full ${item.rank === 1 ? "bg-primary" : "bg-green-400/60"}`}
            />
          </div>
        </div>
      ))}
      <p className="text-center text-xs text-muted-foreground/50">
        {voters} of {reveal.participantCount} ranked
      </p>
    </div>
  );
}

const WORD_COLORS = [
  "text-primary",
  "text-rose-400",
  "text-sky-400",
  "text-emerald-400",
  "text-violet-400",
  "text-orange-400",
  "text-pink-400",
  "text-cyan-400",
];
