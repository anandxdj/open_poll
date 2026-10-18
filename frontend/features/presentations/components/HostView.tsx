"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Copy,
  Flag,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Radio,
  RotateCcw,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import {
  advanceSlide,
  endPresentation,
  getHostState,
  openLobby,
  revealCurrentSlide,
} from "../api/presentationApi";
import { usePresentationSocket } from "../hooks/usePresentationSocket";
import { useCountdown } from "../hooks/useCountdown";
import { PresentationTimer } from "./PresentationTimer";
import { Leaderboard } from "./Leaderboard";
import { WordCloud } from "./WordCloud";
import { CardFillRevealChart } from "./CardFillRevealChart";
import type {
  LeaderboardEntry,
  Presentation,
  PresentationRealtimeEvent,
  RevealDistribution,
  RevealPayload,
} from "../types";
import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";

interface HostViewProps {
  presentationId: string;
}

export function HostView({ presentationId }: HostViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isResetRequested = searchParams?.get("reset") === "true";

  const [deck, setDeck] = useState<Presentation | null>(null);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [participants, setParticipants] = useState<{ participantId: string; name: string }[]>([]);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [liveDistribution, setLiveDistribution] = useState<RevealDistribution | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const revealFiredRef = useRef(false);
  const hasResetLobbyRef = useRef(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const refresh = useCallback(async () => {
    try {
      const state = await getHostState(presentationId);
      let current = state.presentation ?? state.quiz;
      if (!current) throw new Error("Host state is missing the presentation deck");

      // On initial mount: ensure lobby is opened for draft/ended/reset requests (only run once)
      if (!hasResetLobbyRef.current) {
        hasResetLobbyRef.current = true;
        if (current.status === "draft" || current.status === "ended" || isResetRequested) {
          const loaded = current;
          // Fall back to the loaded state if the lobby cannot be (re)opened.
          current = await openLobby(presentationId).catch(() => loaded);
        }
      }

      setDeck(current);
      setServerNow(state.serverNow);
      setParticipants(state.participants);
      setAnsweredCount(state.answeredCount);
      if (state.liveDistribution) setLiveDistribution(state.liveDistribution);
      if (state.leaderboard) setLeaderboard(state.leaderboard);
    } catch (err: unknown) {
      const status = getApiErrorStatus(err);
      if (status === 404) setLoadError("Presentation deck not found.");
      else if (status === 401 || status === 403) setLoadError("You are not authorized to host this deck.");
      else setLoadError(getApiErrorMessage(err) || "Could not load deck.");
    } finally {
      setLoading(false);
    }
  }, [presentationId, isResetRequested]);

  // Every setState in refresh() runs after its awaited fetch, but the rule does
  // not model `await` and reports them as synchronous.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (deck?.status !== "lobby") return;
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [deck?.status, refresh]);

  const { connected } = usePresentationSocket(
    presentationId,
    useCallback((event: PresentationRealtimeEvent) => {
      switch (event.type) {
        case "participant:joined": {
          const { participantId, name } = event.payload as { participantId: string; name: string };
          setParticipants((prev) =>
            prev.some((p) => p.participantId === participantId)
              ? prev
              : [...prev, { participantId, name }]
          );
          break;
        }
        case "answer:received": {
          const payload = event.payload as { answeredCount: number; distribution?: RevealDistribution };
          setAnsweredCount(payload.answeredCount);
          if (payload.distribution) setLiveDistribution(payload.distribution);
          break;
        }
        case "question:revealed": {
          setReveal(event.payload as unknown as RevealPayload);
          revealFiredRef.current = true;
          void refresh();
          break;
        }
        case "question:started": {
          setLiveDistribution(null);
          setReveal(null);
          setAnsweredCount(0);
          revealFiredRef.current = false;
          void refresh();
          break;
        }
        case "leaderboard:shown":
        case "quiz:ended": {
          void refresh();
          break;
        }
      }
    }, [refresh]),
    { role: "host" }
  );

  const activeSlideIndex = deck?.currentSlideIndex ?? 0;
  const isLastSlide = deck ? activeSlideIndex >= deck.slides.length - 1 : false;
  const currentSlide = deck?.slides[activeSlideIndex] ?? null;
  const isLeaderboardSlide = currentSlide?.type === "leaderboard";

  const endsAt = deck?.status === "active" ? deck.questionEndsAt ?? null : null;
  const { secondsLeft, progress, expired } = useCountdown(
    endsAt,
    serverNow,
    currentSlide?.timeLimit ?? 30
  );

  // Auto-reveal when timer hits 0
  useEffect(() => {
    if (
      deck?.status !== "active" ||
      !expired ||
      !endsAt ||
      busy ||
      revealFiredRef.current
    ) return;
    const slide = deck.slides[deck.currentSlideIndex];
    if (!slide || slide.type === "leaderboard") return;
    revealFiredRef.current = true;
    void (async () => {
      try { await revealCurrentSlide(presentationId); } catch {}
    })();
  }, [expired, deck?.status, endsAt, busy, presentationId]);

  const handleOpenLobby = async () => {
    setBusy(true);
    try {
      const q = await openLobby(presentationId);
      setDeck(q);
      setParticipants([]);
      setAnsweredCount(0);
      setReveal(null);
      setLiveDistribution(null);
      setLeaderboard([]);
      toast.success("Lobby opened — code " + q.joinCode);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to open lobby.");
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (targetIndex?: number) => {
    setBusy(true);
    try {
      const q = await advanceSlide(presentationId, targetIndex);
      setDeck(q);
      setServerNow(new Date().toISOString());
      setReveal(null);
      setAnsweredCount(0);
      revealFiredRef.current = false;
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to advance slide.");
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (!window.confirm("End the session for all participants?")) return;
    setBusy(true);
    try {
      const q = await endPresentation(presentationId);
      setDeck(q);
      toast.success("Session ended.");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to end session.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!deck || deck.status !== "active") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "ArrowRight" || e.key === "PageDown") && !isLastSlide) {
        void handleAdvance(activeSlideIndex + 1);
      } else if ((e.key === "ArrowLeft" || e.key === "PageUp") && activeSlideIndex > 0) {
        void handleAdvance(activeSlideIndex - 1);
      } else if (e.key.toLowerCase() === "f") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deck, activeSlideIndex, isLastSlide]);

  const playUrl = typeof window !== "undefined" && deck?.joinCode ? `${window.location.origin}/live/${deck.joinCode}` : "";

  const handleCopyUrl = async () => {
    if (!playUrl) return;
    try {
      await navigator.clipboard.writeText(playUrl);
      setCopiedUrl(true);
      toast.success("Join link copied to clipboard!");
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toast.error("Failed to copy link.");
    }
  };

  const handleCopyCode = async () => {
    if (!deck?.joinCode) return;
    try {
      await navigator.clipboard.writeText(deck.joinCode);
      setCopiedCode(true);
      toast.success("Join code copied to clipboard!");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error("Failed to copy code.");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505]">
        <Loader2 className="size-8 animate-spin text-primary/60" />
      </div>
    );
  }

  if (loadError || !deck) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] px-6 text-center text-white">
        <p className="text-sm font-semibold text-rose-400">{loadError ?? "Presentation deck not found."}</p>
        <button onClick={() => router.push("/polls")} className="text-xs text-white/40 underline underline-offset-2">
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden select-none">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5 bg-[#0a0a0a]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-full bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 text-rose-400 text-[10px] font-bold tracking-wider uppercase flex items-center gap-1.5 shrink-0">
            <Radio className="size-3 animate-pulse" /> LIVE HOST
          </div>
          <h1 className="text-sm font-bold leading-none text-white/90 truncate">{deck.title}</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white/60">
            <Users className="size-3.5" /> {participants.length}
          </div>
          <button
            type="button"
            onClick={handleCopyUrl}
            title="Click to copy join link"
            className="font-mono text-xs font-bold tracking-widest text-primary bg-primary/10 border border-primary/25 px-3.5 py-1 rounded-full hover:bg-primary/20 transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span>{deck.joinCode}</span>
            {copiedUrl ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3 text-primary/70" />}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLeaderboardModal((prev) => !prev)}
            title="Toggle Leaderboard"
            className={`h-8 rounded-full border px-3 text-xs font-bold transition-all flex items-center gap-1.5 ${
              showLeaderboardModal
                ? "bg-amber-400 text-slate-950 border-amber-400 shadow-md shadow-amber-400/20"
                : "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
            }`}
          >
            <Trophy className="size-3.5" />
            <span className="hidden sm:inline">Leaderboard</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen (F)"
            className="size-8 text-white/60 hover:text-white hover:bg-white/10"
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          {deck.status === "ended" && (
            <Button
              onClick={handleOpenLobby}
              disabled={busy}
              className="h-8 rounded-full bg-primary text-primary-foreground font-bold px-4 text-xs hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="size-3 mr-1.5" /> Host Again
            </Button>
          )}
        </div>
      </header>

      {/* Leaderboard Overlay Modal */}
      {showLeaderboardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="max-w-md w-full rounded-3xl border border-amber-400/20 bg-[#0d0d0d] p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
                <Trophy className="size-5" /> Live Leaderboard
              </div>
              <button
                onClick={() => setShowLeaderboardModal(false)}
                className="size-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors text-xs font-bold"
              >
                ✕
              </button>
            </div>
            <Leaderboard entries={leaderboard} />
          </div>
        </div>
      )}

      {!connected && deck.status !== "draft" && deck.status !== "ended" && (
        <div className="flex items-center justify-center gap-2 bg-rose-500/10 border-b border-rose-500/20 px-4 py-1.5 text-xs font-semibold text-rose-400 shrink-0">
          <Radio className="size-3 animate-pulse" /> Reconnecting…
        </div>
      )}

      <main className="relative flex-1 overflow-hidden flex flex-col items-center justify-center p-4 sm:p-6">
        {(deck.status === "lobby" || deck.status === "draft") && (
          <div className="max-w-xl w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 my-auto">
            <div className="space-y-2">
              <p className="text-xs font-mono font-bold uppercase tracking-widest text-white/50 flex items-center justify-center gap-1.5 flex-wrap">
                <span>SCAN THE QR — OR JOIN AT</span>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  title="Click to copy join link"
                  className="inline-flex items-center gap-1.5 text-primary font-extrabold underline font-mono hover:text-primary/80 transition-all cursor-pointer group focus:outline-none focus:ring-2 focus:ring-primary/50 rounded px-2 py-0.5 bg-primary/10 hover:bg-primary/20 border border-primary/30"
                >
                  <span>{playUrl ? playUrl.replace(/^https?:\/\//, "").toUpperCase() : ""}</span>
                  {copiedUrl ? (
                    <Check className="size-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="size-3.5 text-primary/70 group-hover:text-primary shrink-0 transition-colors" />
                  )}
                </button>
                <span>WITH CODE</span>
              </p>
            </div>

            {/* Large Join Code & QR Code container */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              {/* Code Box */}
              <button
                type="button"
                onClick={handleCopyCode}
                title="Click to copy join code"
                className="rounded-[2.5rem] border border-white/15 bg-white/5 hover:bg-white/10 hover:border-primary/40 transition-all px-10 py-8 text-center shadow-2xl flex flex-col items-center justify-center min-w-[280px] min-h-[200px] backdrop-blur-xl group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary/80 mb-2 flex items-center gap-1.5">
                  JOIN CODE
                  {copiedCode ? (
                    <Check className="size-3 text-emerald-400" />
                  ) : (
                    <Copy className="size-3 opacity-60 group-hover:opacity-100 text-primary transition-opacity" />
                  )}
                </span>
                <span className="text-5xl font-extrabold tracking-[0.2em] font-mono text-primary drop-shadow-md group-hover:scale-105 transition-transform">
                  {deck.joinCode}
                </span>
                <span className="text-[10px] text-white/40 mt-2 transition-opacity">
                  {copiedCode ? "Copied code!" : "Click to copy code"}
                </span>
              </button>

              {/* QR Code Box */}
              {playUrl && (
                <div className="p-5 bg-white rounded-[2.5rem] shadow-2xl flex items-center justify-center min-h-[200px] min-w-[200px]">
                  <QRCodeSVG value={playUrl} size={160} aria-label={`Join at ${playUrl}`} />
                </div>
              )}
            </div>

            {/* Joined count & chips */}
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-white/50">
                <Users className="size-4 text-primary" /> {participants.length} JOINED
              </div>
              {participants.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-2 max-h-36 overflow-y-auto p-2">
                  {participants.map((p) => (
                    <span
                      key={p.participantId}
                      className="rounded-full bg-white/10 border border-white/15 px-4 py-1.5 text-xs font-semibold text-white/90 shadow-sm"
                    >
                      {p.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-white/30 italic">Waiting for players to enter code...</p>
              )}
            </div>

            {/* Start button */}
            <div className="pt-2">
              {deck.status === "draft" ? (
                <Button
                  onClick={handleOpenLobby}
                  disabled={busy}
                  className="h-12 rounded-full bg-primary text-primary-foreground font-bold px-8 text-sm shadow-xl shadow-primary/20 hover:opacity-90 transition-all active:scale-[0.98]"
                >
                  <Radio className="size-4 mr-2 animate-pulse" /> Open Lobby & Start
                </Button>
              ) : (
                <Button
                  onClick={() => handleAdvance()}
                  disabled={busy || participants.length === 0}
                  className="h-12 rounded-full bg-primary text-primary-foreground font-bold px-8 text-sm shadow-xl shadow-primary/20 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-40"
                >
                  <Play className="size-4 mr-2 fill-current" /> Start <ArrowRight className="size-4 ml-1.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        {deck.status === "active" && currentSlide && (
          <>
            {/* Left Response Counter Badge */}
            <div className="absolute left-6 bottom-5 z-10 hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-3.5 py-1.5 text-xs text-white/80 shadow-md">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="font-mono font-bold text-white tracking-tight">{answeredCount}</span>
              <span className="text-white/40 font-mono">/</span>
              <span className="font-mono text-white/60">{participants.length}</span>
              <span className="text-white/50 font-medium ml-0.5">answered</span>
            </div>

            {/* Right Leaderboard Icon Button */}
            <button
              onClick={() => setShowLeaderboardModal(true)}
              title="View Leaderboard"
              className="absolute right-6 bottom-5 z-10 hidden sm:flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-300 backdrop-blur-md shadow-lg hover:bg-amber-400/20 transition-all hover:scale-105 active:scale-95"
            >
              <Trophy className="size-4 text-amber-400" />
              <span>Leaderboard</span>
            </button>

            <div className="max-w-3xl w-full space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 my-auto font-sans">
              <div className="text-center space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-primary font-mono">
                  SLIDE {activeSlideIndex + 1} OF {deck.slides.length}
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight px-4 text-white leading-tight">
                  {currentSlide.question}
                </h2>
              </div>

              {isLeaderboardSlide ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2 text-sm font-bold text-primary">
                    <Trophy className="size-4" /> Leaderboard
                  </div>
                  <Leaderboard entries={leaderboard} />
                </div>
              ) : (
                <>
                  {!reveal && secondsLeft > 0 && (
                    <PresentationTimer secondsLeft={secondsLeft} progress={progress} />
                  )}
                  {currentSlide.type === "wordcloud" && liveDistribution?.kind === "words" ? (
                    <WordCloud words={liveDistribution.words} showCounts />
                  ) : liveDistribution ? (
                    <div className="pt-2 max-h-[55vh] overflow-y-auto">
                      <CardFillRevealChart
                        distribution={liveDistribution}
                        isReveal={!!reveal}
                        totalParticipants={participants.length}
                      />
                    </div>
                  ) : null}
                  <p className="sm:hidden text-center text-xs text-white/40 font-mono">
                    {answeredCount} / {participants.length} answered
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {deck.status === "ended" && (
          <div className="max-w-md w-full space-y-6 text-center animate-in fade-in slide-in-from-bottom-8 duration-700 my-auto">
            <h2 className="text-2xl font-bold">Session ended</h2>
            <Leaderboard entries={leaderboard} title="Final standings" />
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                onClick={handleOpenLobby}
                disabled={busy}
                className="h-10 rounded-full bg-primary text-primary-foreground font-bold px-6 text-xs shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity"
              >
                <RotateCcw className="size-4 mr-2" /> Host Again
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/polls")}
                className="h-10 rounded-full border-white/20 text-white font-semibold px-5 text-xs hover:bg-white/10"
              >
                Back to Dashboard
              </Button>
            </div>
          </div>
        )}
      </main>

      <footer className="shrink-0 border-t border-white/10 bg-[#0a0a0a] px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-[120px]">
          {deck.status === "active" && activeSlideIndex > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAdvance(activeSlideIndex - 1)}
              disabled={busy}
              className="h-8 rounded-full border-white/15 bg-white/5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="size-3.5 mr-1" /> Prev Slide
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {deck.status === "active" && (
            !isLastSlide ? (
              <Button
                onClick={() => handleAdvance()}
                disabled={busy}
                className="h-9 rounded-full bg-primary text-primary-foreground font-bold px-6 text-xs hover:opacity-90 shadow-md shadow-primary/20"
              >
                Next Slide <ArrowRight className="size-3.5 ml-1.5" />
              </Button>
            ) : (
              <Button
                onClick={handleEnd}
                disabled={busy}
                className="h-9 rounded-full bg-rose-500 text-white font-bold px-6 text-xs hover:bg-rose-600 shadow-md shadow-rose-500/20"
              >
                <Flag className="size-3.5 mr-1.5" /> End Session
              </Button>
            )
          )}
          {deck.status === "ended" && (
            <Button
              onClick={handleOpenLobby}
              disabled={busy}
              className="h-9 rounded-full bg-primary text-primary-foreground font-bold px-6 text-xs hover:opacity-90"
            >
              <RotateCcw className="size-3.5 mr-1.5" /> Host Again
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 min-w-[120px] justify-end text-xs text-white/40 font-mono">
          {deck.status === "active" && (
            <span>{activeSlideIndex + 1} / {deck.slides.length}</span>
          )}
        </div>
      </footer>
    </div>
  );
}

