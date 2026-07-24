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
          const payload = event.payload as { answeredCount: number };
          setAnsweredCount(payload.answeredCount);
          break;
        }
        case "question:started":
        case "question:revealed":
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
            <Button
              onClick={handleReveal}
              disabled={busy}
              variant="outline"
              className="h-9 rounded-full px-4 text-xs font-semibold border-white/20"
            >
              <Eye className="size-3.5 mr-1.5" /> Reveal Answers
            </Button>
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
              <PresentationTimer secondsLeft={secondsLeft} progress={progress} />
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
