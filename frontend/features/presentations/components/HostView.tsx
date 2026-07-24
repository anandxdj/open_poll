"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Flag,
  Loader2,
  Play,
  Radio,
  Presentation as PresentationIcon,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import {
  endPresentation,
  getHostState,
  openLobby,
  revealAnswers,
  showLeaderboard,
  startNextQuestion,
} from "../api/presentationApi";
import { usePresentationSocket } from "../hooks/usePresentationSocket";
import { useCountdown } from "../hooks/useCountdown";
import { PresentationTimer } from "./PresentationTimer";
import { Leaderboard } from "./Leaderboard";
import type {
  LeaderboardEntry,
  Presentation,
  PresentationRealtimeEvent,
  RevealDistribution,
  RevealPayload,
} from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

interface HostViewProps {
  presentationId: string;
  quizId?: string;
}

export function HostView({ presentationId: pid, quizId }: HostViewProps) {
  const presentationId = pid || quizId || "";
  const router = useRouter();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [participants, setParticipants] = useState<{ participantId: string; name: string }[]>([]);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [liveDistribution, setLiveDistribution] = useState<RevealDistribution | null>(null);
  const [showLiveResults, setShowLiveResults] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await getHostState(presentationId);
      setPresentation(state.presentation || state.quiz || null);
      setServerNow(state.serverNow);
      setParticipants(state.participants);
      setAnsweredCount(state.answeredCount);
      if (state.liveDistribution) setLiveDistribution(state.liveDistribution);
      if (state.leaderboard) setLeaderboard(state.leaderboard);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to load presentation host state.");
    } finally {
      setLoading(false);
    }
  }, [presentationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fallback periodic polling while in lobby to ensure participant list updates reliably
  useEffect(() => {
    if (presentation?.status !== "lobby") return;
    const interval = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [presentation?.status, refresh]);

  usePresentationSocket(
    presentationId,
    useCallback((event: PresentationRealtimeEvent) => {
      switch (event.type) {
        case "participant:joined": {
          const payload = event.payload as { participantId: string; name: string };
          setParticipants((prev) =>
            prev.some((p) => p.participantId === payload.participantId)
              ? prev
              : [...prev, { participantId: payload.participantId, name: payload.name }]
          );
          break;
        }
        case "answer:received": {
          const payload = event.payload as { answeredCount: number; distribution?: RevealDistribution };
          setAnsweredCount(payload.answeredCount);
          if (payload.distribution) {
            setLiveDistribution(payload.distribution);
          }
          break;
        }
        case "question:revealed": {
          setReveal(event.payload as unknown as RevealPayload);
          void refresh();
          break;
        }
        case "question:started": {
          setLiveDistribution(null);
          setReveal(null);
          setAnsweredCount(0);
          void refresh();
          break;
        }
        case "leaderboard:shown":
        case "lobby:opened":
        case "quiz:ended": {
          void refresh();
          break;
        }
      }
    }, [refresh])
  );

  const targetMs = useMemo(() => {
    if (presentation?.status !== "question" || !presentation.questionEndsAt) return null;
    return new Date(presentation.questionEndsAt).getTime();
  }, [presentation?.status, presentation?.questionEndsAt]);

  const { secondsLeft, progress } = useCountdown(targetMs, serverNow);

  const handleOpenLobby = async () => {
    setBusy(true);
    try {
      const p = await openLobby(presentationId);
      setPresentation(p);
      toast.success("Lobby opened — participants can join with code " + p.joinCode);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to open lobby.");
    } finally {
      setBusy(false);
    }
  };

  const handleStartNext = async () => {
    setBusy(true);
    try {
      const p = await startNextQuestion(presentationId);
      setPresentation(p);
      setReveal(null);
      setAnsweredCount(0);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to start next slide.");
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    setBusy(true);
    try {
      const p = await revealAnswers(presentationId);
      setPresentation(p);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to reveal answers.");
    } finally {
      setBusy(false);
    }
  };

  const handleLeaderboard = async () => {
    setBusy(true);
    try {
      const p = await showLeaderboard(presentationId);
      setPresentation(p);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to show leaderboard.");
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    setBusy(true);
    try {
      const p = await endPresentation(presentationId);
      setPresentation(p);
      toast.success("Presentation deck ended.");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to end presentation.");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="size-8 animate-spin text-primary/60" />
      </div>
    );
  }

  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/live/${presentation.joinCode}` : "";
  const activeSlideIndex = presentation.currentSlideIndex >= 0 ? presentation.currentSlideIndex : 0;
  const currentSlide = presentation.slides[activeSlideIndex];
  const isLastSlide = activeSlideIndex === presentation.slides.length - 1;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary selection:text-primary-foreground">
      {/* Top Bar */}
      <header className="flex h-16 items-center justify-between border-b border-border/40 px-6 bg-card/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
            <PresentationIcon className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-none text-foreground/90">{presentation.title}</h1>
            <p className="text-[10px] font-mono text-muted-foreground mt-1 uppercase tracking-widest">
              Code: <span className="text-primary font-bold">{presentation.joinCode}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {presentation.status === "draft" && (
            <Button
              onClick={handleOpenLobby}
              disabled={busy}
              className="h-9 rounded-full bg-primary text-primary-foreground font-semibold px-4 text-xs"
            >
              <Radio className="size-3.5 mr-1.5 animate-pulse" /> Open Lobby
            </Button>
          )}

          {presentation.status === "lobby" && (
            <Button
              onClick={handleStartNext}
              disabled={busy || participants.length === 0}
              className="h-9 rounded-full bg-primary text-primary-foreground font-semibold px-5 text-xs"
            >
              <Play className="size-3.5 mr-1.5" /> Start Presentation
            </Button>
          )}

          {presentation.status === "question" && (
            <>
              <Button
                onClick={() => setShowLiveResults((prev) => !prev)}
                variant="outline"
                className="h-9 rounded-full px-4 text-xs font-semibold border-white/20"
              >
                {showLiveResults ? (
                  <>
                    <EyeOff className="size-3.5 mr-1.5" /> Hide Live View
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5 mr-1.5" /> Show Live View
                  </>
                )}
              </Button>
              <Button
                onClick={handleReveal}
                disabled={busy}
                variant="outline"
                className="h-9 rounded-full px-4 text-xs font-semibold border-white/20"
              >
                <Eye className="size-3.5 mr-1.5" /> Reveal Answers
              </Button>
            </>
          )}

          {presentation.status === "reveal" && (
            <>
              <Button
                onClick={handleLeaderboard}
                disabled={busy}
                variant="outline"
                className="h-9 rounded-full px-4 text-xs font-semibold border-white/20"
              >
                Leaderboard
              </Button>
              {!isLastSlide ? (
                <Button
                  onClick={handleStartNext}
                  disabled={busy}
                  className="h-9 rounded-full bg-primary text-primary-foreground font-semibold px-4 text-xs"
                >
                  Next Slide <ArrowRight className="size-3.5 ml-1.5" />
                </Button>
              ) : (
                <Button
                  onClick={handleEnd}
                  disabled={busy}
                  className="h-9 rounded-full bg-red-500 text-white font-semibold px-4 text-xs"
                >
                  <Flag className="size-3.5 mr-1.5" /> End Deck
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main Host Area */}
      <main className="flex-1 flex flex-col justify-center items-center p-6">
        {presentation.status === "lobby" && (
          <div className="max-w-md w-full text-center space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Join Live Session</h2>
              <p className="text-sm text-muted-foreground">Scan QR or enter code to join on your phone</p>
            </div>

            {joinUrl && (
              <div className="p-4 bg-white rounded-3xl inline-block shadow-2xl border border-white/20 mx-auto">
                <QRCodeSVG value={joinUrl} size={180} />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
                <Users className="size-4" /> {participants.length} Participant{participants.length !== 1 ? "s" : ""} Joined
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-h-36 overflow-y-auto p-2">
                {participants.map((p) => (
                  <span
                    key={p.participantId}
                    className="rounded-full bg-secondary/40 border border-border px-3 py-1 text-xs font-semibold text-foreground/80"
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {(presentation.status === "question" || presentation.status === "reveal") && currentSlide && (
          <div className="max-w-2xl w-full space-y-6">
            <div className="text-center space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                Slide {activeSlideIndex + 1} of {presentation.slides.length}
              </span>
              <h2 className="text-2xl font-bold tracking-tight">{currentSlide.question}</h2>
            </div>

            {presentation.status === "question" && (
              <>
                <PresentationTimer secondsLeft={secondsLeft} progress={progress} />
                {showLiveResults && liveDistribution && (
                  <div className="pt-2">
                    <RevealChart distribution={liveDistribution} isReveal={false} />
                  </div>
                )}
              </>
            )}

            {presentation.status === "reveal" && (
              reveal ? (
                <RevealChart reveal={reveal} isReveal={true} />
              ) : (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-6 animate-spin text-primary/60" />
                </div>
              )
            )}

            <div className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
              {answeredCount} Response{answeredCount !== 1 ? "s" : ""} received
            </div>
          </div>
        )}

        {presentation.status === "leaderboard" && (
          <div className="max-w-md w-full">
            <Leaderboard entries={leaderboard} />
          </div>
        )}
      </main>
    </div>
  );
}

function RevealChart({
  reveal,
  distribution: propDist,
  isReveal = true,
}: {
  reveal?: RevealPayload | null;
  distribution?: RevealDistribution | null;
  isReveal?: boolean;
}) {
  const dist = propDist || reveal?.distribution;
  if (!dist) return null;

  if (dist.kind === "options") {
    const { counts, options } = dist;
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
        {reveal && (
          <p className="text-center text-xs text-muted-foreground/50">
            {reveal.answeredCount}/{reveal.participantCount} answered
          </p>
        )}
      </div>
    );
  }

  if (dist.kind === "text") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap justify-center gap-2">
          {dist.answers.map((answer, i) => {
            const showCorrect = isReveal && answer.isCorrect;
            return (
              <span
                key={i}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  showCorrect
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-white/10 bg-white/[0.03] text-foreground/70"
                }`}
              >
                {answer.text} <span className="opacity-60">×{answer.count}</span>
              </span>
            );
          })}
          {dist.answers.length === 0 && (
            <p className="text-sm text-muted-foreground/50">No answers were submitted.</p>
          )}
        </div>
        {isReveal && dist.acceptedAnswers && (
          <p className="text-center text-xs text-muted-foreground/60">
            Accepted: {dist.acceptedAnswers.join(", ")}
          </p>
        )}
      </div>
    );
  }

  if (dist.kind === "words") {
    const { words } = dist;
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
        {reveal && (
          <p className="text-center text-xs text-muted-foreground/50">
            {reveal.answeredCount}/{reveal.participantCount} answered
          </p>
        )}
      </div>
    );
  }

  if (dist.kind === "responses") {
    const { responses } = dist;
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
        {reveal && (
          <p className="text-center text-xs text-muted-foreground/50">
            {reveal.answeredCount}/{reveal.participantCount} answered
          </p>
        )}
      </div>
    );
  }

  if (dist.kind === "scales") {
    const { statements, scaleMax, minLabel, maxLabel } = dist;
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
        {reveal && (
          <p className="text-center text-xs text-muted-foreground/50">
            {reveal.answeredCount}/{reveal.participantCount} answered
          </p>
        )}
      </div>
    );
  }

  // ranking — combined order by Borda points
  const { items, voters } = dist;
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
      {reveal ? (
        <p className="text-center text-xs text-muted-foreground/50">
          {reveal.answeredCount}/{reveal.participantCount} answered
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground/50">
          {voters} response{voters !== 1 ? "s" : ""}
        </p>
      )}
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
