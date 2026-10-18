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
import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
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



interface PlayViewProps {
  code: string;
}

type StoredParticipant = { participantId: string; token: string; name: string };

/** Participant session saved by a previous join on this device, if any. */
function readStoredParticipant(storageKey: string): StoredParticipant | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.participantId && parsed.token && parsed.name) {
        return { participantId: parsed.participantId, token: parsed.token, name: parsed.name };
      }
    }
  } catch {}
  return null;
}

export function PlayView({ code }: PlayViewProps) {
  const [info, setInfo] = useState<PublicPresentationInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const storageKey = `openpoll_participant_${code}`;

  // Participant session (stored in localStorage per code). Restored on the
  // first client render: until the deck info loads this view only renders a
  // loader, so server and client markup still match. `code` is a route param,
  // so a different code mounts a fresh PlayView.
  const [storedParticipant] = useState(() => readStoredParticipant(storageKey));
  const [nameInput, setNameInput] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(storedParticipant?.participantId ?? null);
  const [participantName, setParticipantName] = useState<string | null>(storedParticipant?.name ?? null);
  const [token, setToken] = useState<string | null>(storedParticipant?.token ?? null);
  const [joining, setJoining] = useState(false);

  // Live question state
  const [currentSlide, setCurrentSlide] = useState<LiveSlide | null>(null);
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
  // Reveal payload (correct answer) — arrives when host timer hits 0. Status
  // stays "active"; this drives the correct/wrong highlight.
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  // Leaderboard slide currently on screen (host advanced to a leaderboard slide).
  const [leaderboardView, setLeaderboardView] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await getPresentationByCode(code);
        setInfo(data);
        if (data.currentSlide) {
          setCurrentSlide(data.currentSlide);
          setEndsAt(data.questionEndsAt ?? null);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  const fetchMeState = async () => {
    const presentationId = info?.presentationId || info?.quizId;
    if (!presentationId || !participantId || !token) return;
    try {
      const state = await getParticipantState(presentationId, participantId, token);
      setMeState(state);
    } catch {}
  };

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
          setEndsAt(payload.endsAt);
          setReveal(null);
          setLeaderboardView(null);
          setInfo((prev) =>
            prev
              ? {
                  ...prev,
                  status: "active",
                  currentSlideIndex: payload.slide.slideIndex,
                }
              : prev
          );
          // Reset form state for new question
          setSubmittedSlideIndex(null);
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
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Could not join presentation.");
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
      // Fetch immediate result so scored slides can show green/red on the
      // participant's own choice right away (correct answer still hidden until reveal).
      void fetchMeState();
    } catch (err) {
      if (getApiErrorStatus(err) === 409) {
        setSubmittedSlideIndex(currentSlide.slideIndex);
        void fetchMeState();
      } else {
        toast.error(getApiErrorMessage(err) || "Could not submit answer.");
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
