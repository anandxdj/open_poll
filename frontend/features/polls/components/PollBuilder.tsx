"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, BarChart2, ChevronLeft, ChevronRight, Loader2, Plus, Send, Sparkles, Target } from "lucide-react";

import { defaultDatetimeLocal, toDatetimeLocalValue } from "@/features/polls/components/create/datetime";
import { PollQuestionCard } from "@/features/polls/components/create/PollQuestionCard";
import { PublishSettingsModal } from "@/features/polls/components/create/PublishSettingsModal";
import type { QuestionForm } from "@/features/polls/components/create/types";
import { LivePreview } from "@/features/polls/components/create/LivePreview";
import { useCreatorStore, type Poll } from "@/features/polls/store/useCreatorStore";
import { type AiTone, defaultAiExpiresAtIso, generateDraft, type GeneratedPollDraft } from "@/features/ai/api/generateDraft";
import { AiPromptModal } from "@/features/ai/components/AiPromptModal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import axios from "axios";

const emptyQuestion = (): QuestionForm => ({
  text: "",
  isMandatory: true,
  options: ["", ""],
});

function previewLabel(text: string, n: number) {
  const t = text.trim();
  if (!t) return `Q${n} — Empty`;
  return t.length > 30 ? `${t.slice(0, 28).trim()}…` : t;
}

const ease = [0.32, 0.72, 0, 1] as const;

// Module-level lock to prevent double-creation across component remounts during navigation
let isGlobalCreating = false;

/** Drops blank options and remaps the correct-answer indices onto what is left. */
function withoutBlankOptions(q: QuestionForm): { options: string[]; correctOptionIndices: number[] } {
  const kept: number[] = [];
  q.options.forEach((o, i) => {
    if (o.trim()) kept.push(i);
  });
  return {
    options: kept.map((i) => q.options[i]!.trim()),
    correctOptionIndices: (q.correctOptionIndices || [])
      .map((c) => kept.indexOf(c))
      .filter((c) => c >= 0),
  };
}

export function PollBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { createPoll, updatePoll, polls, fetchPolls, isLoading } = useCreatorStore();

  // Pre-fill title from query param set by CreatePollModal
  const nameFromUrl = searchParams.get("name") ?? "";
  const modeFromUrl = searchParams.get("mode") ?? "manual"; // "ai" | "manual"
  const pollTypeFromUrl = (searchParams.get("pollType") as "POLL" | "TRIAL") || "POLL";
  const draftIdFromUrl = searchParams.get("draftId");

  const [title, setTitle] = useState(nameFromUrl);
  const [pollType, setPollType] = useState<"POLL" | "TRIAL">(pollTypeFromUrl);
  const [passingScorePercentage, setPassingScorePercentage] = useState<number>(70);
  const [expiresAtLocal, setExpiresAtLocal] = useState(defaultDatetimeLocal);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isPublished, setIsPublished] = useState(true);
  const [questions, setQuestions] = useState<QuestionForm[]>(() => [emptyQuestion()]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [isDraftLoaded, setIsDraftLoaded] = useState(!draftIdFromUrl);

  // Populate the form from the stored draft whenever the store's poll list or
  // the draft id changes (adjusting state during render instead of in an effect).
  const [draftSyncSource, setDraftSyncSource] = useState<{
    polls: Poll[];
    draftId: string | null;
  } | null>(null);
  if (draftSyncSource?.polls !== polls || draftSyncSource.draftId !== draftIdFromUrl) {
    setDraftSyncSource({ polls, draftId: draftIdFromUrl });
    if (draftIdFromUrl) {
      const poll = polls.find(p => p._id === draftIdFromUrl);
      if (poll) {
        setTitle(poll.title);
        if (poll.pollType) setPollType(poll.pollType);
        if (typeof poll.passingScorePercentage === 'number') setPassingScorePercentage(poll.passingScorePercentage);
        setIsAnonymous(poll.isAnonymous);
        setIsPublished(poll.isPublished);
        setExpiresAtLocal(toDatetimeLocalValue(poll.expiresAt));
        setQuestions(
          poll.questions.map((q) => {
            const opts = [...q.options];
            while (opts.length < 2) opts.push("");
            return {
              _id: q._id,
              text: q.text,
              isMandatory: q.isMandatory,
              options: opts,
              type: q.type || 'single',
              correctOptionIndices: q.correctOptionIndices || [],
              explanation: q.explanation || '',
              points: q.points || 1,
            };
          })
        );
        setIsDraftLoaded(true);
      }
    }
  }

  useEffect(() => {
    // If the draft is not in the store, maybe it hasn't been fetched yet
    if (draftIdFromUrl && !polls.some(p => p._id === draftIdFromUrl)) {
      fetchPolls().catch(() => {});
    }
  }, [draftIdFromUrl, polls, fetchPolls]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-open AI modal if mode=ai (setState only inside timer callback — satisfies react-hooks/set-state-in-effect)
  const [aiTrigger, setAiTrigger] = useState(false);
  const aiFiredForAiUrlRef = useRef(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  useEffect(() => {
    if (modeFromUrl !== "ai") {
      aiFiredForAiUrlRef.current = false;
      return;
    }
    if (aiFiredForAiUrlRef.current) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      aiFiredForAiUrlRef.current = true;
      setAiTrigger(true);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [modeFromUrl]);

  const stateRef = useRef({
    title,
    pollType,
    passingScorePercentage,
    expiresAtLocal,
    isAnonymous,
    questions,
    draftIdFromUrl,
    isDraftLoaded,
    isPublished,
    nameFromUrl, // Add this to track what the "initial" title was
  });

  useEffect(() => {
    stateRef.current = {
      title,
      pollType,
      passingScorePercentage,
      expiresAtLocal,
      isAnonymous,
      questions,
      draftIdFromUrl,
      isDraftLoaded,
      isPublished,
      nameFromUrl
    };
  }, [title, pollType, passingScorePercentage, expiresAtLocal, isAnonymous, questions, draftIdFromUrl, isDraftLoaded, isPublished, nameFromUrl]);

  const isExplicitSaveRef = useRef(false);
  const isSavingRef = useRef(false);

  // Sync title with URL if it's a new poll and title hasn't been edited
  const [titleSyncSource, setTitleSyncSource] = useState({ nameFromUrl, draftIdFromUrl });
  if (titleSyncSource.nameFromUrl !== nameFromUrl || titleSyncSource.draftIdFromUrl !== draftIdFromUrl) {
    setTitleSyncSource({ nameFromUrl, draftIdFromUrl });
    if (!draftIdFromUrl && nameFromUrl) {
      setTitle(nameFromUrl);
    }
  }

  useEffect(() => {
    return () => {
      // If we already saved explicitly, or a save is in progress, or a global creation is locked, BAIL.
      if (isExplicitSaveRef.current || isSavingRef.current || isGlobalCreating) return;
      
      const s = stateRef.current;
      if (!s.isDraftLoaded) return;

      // Only skip auto-draft if it's already a published poll in the store
      if (s.draftIdFromUrl) {
        const poll = useCreatorStore.getState().polls.find(p => p._id === s.draftIdFromUrl);
        if (poll?.isPublished) return;
      }

      // Check if dirty (has some meaningful input)
      // Must have at least one question with text/options OR title changed from initial URL name
      const hasQuestions = s.questions.some(
        (q) => q.text.trim().length > 0 || q.options.some((o) => o.trim().length > 0)
      );
      const titleChanged = s.title.trim().length > 0 && s.title.trim() !== s.nameFromUrl.trim();
      
      if (hasQuestions || titleChanged) {
        // LOCK IT synchronously
        isExplicitSaveRef.current = true;
        isSavingRef.current = true;
        if (!s.draftIdFromUrl) isGlobalCreating = true;

        // normalize data to pass validation for drafts
        const normalizedTitle = s.title.trim() || s.nameFromUrl.trim() || "Untitled Draft";
        const finalTitle = normalizedTitle.length >= 3 ? normalizedTitle : normalizedTitle + " Draft";

        const finalQuestions = s.questions.map((q) => {
          const text = q.text.trim() || "Untitled Question";
          let opts = q.options.map((o) => o.trim()).filter(Boolean);
          if (opts.length === 0) opts = ["Option 1", "Option 2"];
          else if (opts.length === 1) opts.push("Option 2");
          return { ...q, text, options: opts };
        });

        const expMs = new Date(s.expiresAtLocal).getTime();
        const now = Date.now();
        let expiresAt = s.expiresAtLocal;
        if (Number.isNaN(expMs) || expMs < now - 120_000) {
          // Default to tomorrow if invalid
          const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
          expiresAt = tomorrow.toISOString();
        } else {
          expiresAt = new Date(s.expiresAtLocal).toISOString();
        }

        const payload = {
          title: finalTitle,
          pollType: s.pollType,
          passingScorePercentage: s.passingScorePercentage,
          expiresAt: expiresAt,
          isAnonymous: s.isAnonymous,
          isPublished: false, // Save as draft
          questions: finalQuestions.map((q) => ({
            _id: q._id,
            text: q.text,
            isMandatory: q.isMandatory,
            options: q.options,
            type: q.type || 'single',
            correctOptionIndices: q.correctOptionIndices || [],
            explanation: q.explanation || '',
            points: q.points || 1,
          })),
        };

        if (s.draftIdFromUrl) {
          useCreatorStore.getState().updatePoll(s.draftIdFromUrl, payload).catch(() => {}).finally(() => { 
            isSavingRef.current = false; 
          });
        } else {
          useCreatorStore.getState().createPoll(payload).catch(() => {}).finally(() => { 
            isSavingRef.current = false;
            isGlobalCreating = false;
          });
        }
      }
    };
  }, [nameFromUrl]);


  async function handleAiGenerate(params: {
    topic: string;
    tone: AiTone;
    questionCount: number;
    pollType?: 'POLL' | 'TRIAL';
    passingScorePercentage?: number;
  }) {
    setIsAiGenerating(true);
    const toastId = toast.loading("AI is shaping your questions...");
    try {
      const selectedPollType = params.pollType ?? pollType;
      const selectedPassingScore = params.passingScorePercentage ?? passingScorePercentage;

      if (selectedPollType) setPollType(selectedPollType);
      if (typeof selectedPassingScore === 'number') setPassingScorePercentage(selectedPassingScore);

      const draft = await generateDraft({
        ...params,
        pollType: selectedPollType,
        passingScorePercentage: selectedPassingScore,
        isAnonymous,
        expiresAt: defaultAiExpiresAtIso(7),
      });
      applyDraft(draft);
      toast.success("AI questions appended!", { id: toastId });
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.message : undefined;
      toast.error(typeof msg === "string" ? msg : "AI generation failed.", { id: toastId });
    } finally {
      setIsAiGenerating(false);
    }
  }

  const applyDraft = useCallback((draft: GeneratedPollDraft) => {
    if (draft.pollType) setPollType(draft.pollType);
    if (typeof draft.passingScorePercentage === 'number') setPassingScorePercentage(draft.passingScorePercentage);

    setQuestions((prev) => {
      const newQuestions: QuestionForm[] = draft.questions.map((q) => {
        const opts = [...q.options];
        while (opts.length < 2) opts.push("");
        return {
          text: q.text,
          isMandatory: q.isMandatory,
          options: opts,
          type: q.type || 'single',
          correctOptionIndices: q.correctOptionIndices || [],
          explanation: q.explanation || '',
          points: q.points || 1,
        };
      });

      // If we only have one empty question, replace it. Otherwise, append.
      const isInitialEmpty =
        prev.length === 1 &&
        !prev[0].text.trim() &&
        prev[0].options.every((o) => !o.trim());

      return isInitialEmpty ? newQuestions : [...prev, ...newQuestions];
    });

    setAiTrigger(false);
    toast.success("AI questions added!");
  }, []);

  const canSave = useMemo(() => {
    if (title.trim().length < 3) return false;
    if (!expiresAtLocal) return false;
    const exp = new Date(expiresAtLocal).getTime();
    // Allow if it's not more than 2 minutes in the past (buffer for user interaction)
    if (Number.isNaN(exp) || exp < nowMs - 120_000) return false;
    if (questions.length === 0) return false;
    const validQuestions = questions.every((q) => {
      const opts = q.options.map((o) => o.trim()).filter(Boolean);
      const basicValid = q.text.trim().length >= 3 && opts.length >= 2;
      if (!basicValid) return false;
      if (pollType === 'TRIAL') {
        return Boolean(q.correctOptionIndices && q.correctOptionIndices.length > 0);
      }
      return true;
    });
    return validQuestions;
  }, [title, expiresAtLocal, questions, nowMs, pollType]);

  function updateQuestion(index: number, patch: Partial<QuestionForm>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }
  function updateOption(qIndex: number, optIndex: number, value: string) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        const next = [...q.options];
        next[optIndex] = value;
        return { ...q, options: next };
      })
    );
  }
  function addOption(qIndex: number) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIndex && q.options.length < 10 ? { ...q, options: [...q.options, ""] } : q
      )
    );
  }
  function removeOption(qIndex: number, optIndex: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        if (q.options.length <= 2) return q;
        // Correct answers are stored by index, so the ones after the removed
        // option shift down with it; a removed correct option stops being one.
        return {
          ...q,
          options: q.options.filter((_, j) => j !== optIndex),
          correctOptionIndices: (q.correctOptionIndices || [])
            .filter((c) => c !== optIndex)
            .map((c) => (c > optIndex ? c - 1 : c)),
        };
      })
    );
  }
  function addQuestion() {
    const newIndex = questions.length;
    setQuestions((prev) => [...prev, emptyQuestion()]);
    setActiveIndex(newIndex);
  }
  function removeQuestion(index: number) {
    if (questions.length <= 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== index));
    setActiveIndex((prev) => (prev >= index && prev > 0 ? prev - 1 : prev));
  }

  async function handleSaveDraft() {
    if (isSavingRef.current || isGlobalCreating) return;
    
    // LOCK IT synchronously
    isSavingRef.current = true;
    isExplicitSaveRef.current = true;
    if (!draftIdFromUrl) isGlobalCreating = true;

    try {
      const finalTitle = title.trim() || nameFromUrl || "Untitled Draft";
      const finalQuestions = questions.map((q) => {
        const text = q.text.trim() || "Untitled Question";
        let opts = q.options.map((o) => o.trim()).filter(Boolean);
        if (opts.length === 0) opts = ["Option 1", "Option 2"];
        else if (opts.length === 1) opts.push("Option 2");
        return { ...q, text, options: opts };
      });

      const payload = {
        title: finalTitle,
        pollType,
        passingScorePercentage,
        expiresAt: new Date(expiresAtLocal).toISOString(),
        isAnonymous,
        isPublished: false,
        questions: finalQuestions.map((q) => ({
          _id: q._id,
          text: q.text,
          isMandatory: q.isMandatory,
          options: q.options,
          type: q.type || 'single',
          correctOptionIndices: q.correctOptionIndices || [],
          explanation: q.explanation || '',
          points: q.points || 1,
        })),
      };

      if (draftIdFromUrl) {
        const updated = await updatePoll(draftIdFromUrl, payload);
        // Sync questions to get IDs for new questions
        setQuestions(
          updated.questions.map((q) => ({
            _id: q._id,
            text: q.text,
            isMandatory: q.isMandatory,
            options: [...q.options],
            type: q.type || 'single',
            correctOptionIndices: q.correctOptionIndices || [],
            explanation: q.explanation || '',
            points: q.points || 1,
          }))
        );
        toast.success("Draft updated");
      } else {
        const newPoll = await createPoll(payload);
        // Sync everything
        setTitle(newPoll.title);
        setQuestions(
          newPoll.questions.map((q) => ({
            _id: q._id,
            text: q.text,
            isMandatory: q.isMandatory,
            options: [...q.options],
            type: q.type || 'single',
            correctOptionIndices: q.correctOptionIndices || [],
            explanation: q.explanation || '',
            points: q.points || 1,
          }))
        );
        // Update URL so subsequent saves/auto-saves update THIS poll
        const params = new URLSearchParams(searchParams.toString());
        params.set("draftId", newPoll._id);
        router.replace(`/create?${params.toString()}`, { scroll: false });
        toast.success("Saved to drafts");
      }
    } catch {
      isExplicitSaveRef.current = false; // Release lock on failure
      isGlobalCreating = false;
      toast.error("Could not save draft");
    } finally {
      isSavingRef.current = false;
      isGlobalCreating = false;
    }
  }

  async function handleSave() {
    if (isSavingRef.current || isGlobalCreating) return;
    const expMs = new Date(expiresAtLocal).getTime();
    const now = Date.now();
    
    if (!canSave || Number.isNaN(expMs) || expMs < now - 300_000) {
      toast.error("Check title (3+ chars), a future expiry (within 5 min), and each question with 2+ options.");
      return;
    }

    // LOCK IT synchronously
    isSavingRef.current = true;
    isExplicitSaveRef.current = true;

    try {
      const payload = {
        title: title.trim(),
        pollType,
        passingScorePercentage,
        expiresAt: new Date(expiresAtLocal).toISOString(),
        isAnonymous,
        isPublished,
        questions: questions.map((q) => ({
          _id: q._id,
          text: q.text.trim(),
          isMandatory: q.isMandatory,
          ...withoutBlankOptions(q),
          type: q.type || 'single',
          explanation: q.explanation || '',
          points: q.points || 1,
        })),
      };

      if (draftIdFromUrl) {
        await updatePoll(draftIdFromUrl, payload);
      } else {
        await createPoll(payload);
      }
      
      setPublishModalOpen(false);
      toast.success(isPublished ? (pollType === 'TRIAL' ? "Trial published!" : "Poll published!") : "Saved as draft!");
      router.push("/polls");
    } catch {
      isExplicitSaveRef.current = false; // Release lock on failure
      toast.error("Could not save. Try again.");
    } finally {
      isSavingRef.current = false;
    }
  }

  const activeQuestion = questions[activeIndex] ?? null;
  const completedCount = questions.filter(
    (q) => q.text.trim().length >= 3 && q.options.filter((o) => o.trim()).length >= 2
  ).length;

  if (!isDraftLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading draft…
      </div>
    );
  }

  const pressed = (on: boolean) =>
    cn(
      "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
      on ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <>
      {/* Studio layout, the same frame as the deck builder: bar, question rail, editor on graph paper, preview. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/polls")}
            aria-label="Back to polls"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" />
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={pollType === 'TRIAL' ? "Untitled assessment" : "Untitled poll"}
            aria-label="Poll title"
            className="h-9 min-w-0 flex-1 basis-40 rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold tracking-[-0.02em] text-foreground outline-none placeholder:text-muted-foreground hover:border-border focus-visible:border-ring"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Poll type" className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
              <button type="button" aria-pressed={pollType === "POLL"} onClick={() => setPollType("POLL")} className={pressed(pollType === "POLL")}>
                <BarChart2 className={cn("size-4", pollType === "POLL" && "text-accent-ink")} />
                Poll
              </button>
              <button type="button" aria-pressed={pollType === "TRIAL"} onClick={() => setPollType("TRIAL")} className={pressed(pollType === "TRIAL")}>
                <Target className={cn("size-4", pollType === "TRIAL" && "text-accent-ink")} />
                Trial
              </button>
            </div>

            {pollType === 'TRIAL' && (
              <label className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-sm text-muted-foreground">
                Pass score
                <input
                  type="number"
                  min={10}
                  max={100}
                  step={5}
                  value={passingScorePercentage}
                  onChange={(e) => setPassingScorePercentage(Number(e.target.value))}
                  className="w-10 bg-transparent text-center font-mono text-sm text-foreground outline-none"
                />
                %
              </label>
            )}

            <AiPromptModal
              isAnonymous={isAnonymous}
              onGenerate={handleAiGenerate}
              externalOpen={aiTrigger}
              onExternalOpenChange={setAiTrigger}
              initialTopic={title}
              initialPollType={pollType}
              initialPassingScorePercentage={passingScorePercentage}
              isGenerating={isAiGenerating}
            >
              <Button
                type="button"
                variant="outline"
                disabled={isAiGenerating}
                aria-label={isAiGenerating ? "Generating…" : "Generate with AI"}
                className={cn("bg-card", isAiGenerating && "animate-ai-glow")}
              >
                <Sparkles className={cn("text-accent-ink", isAiGenerating && "animate-spin")} />
                <span className="hidden lg:inline">{isAiGenerating ? "Generating…" : "Generate with AI"}</span>
              </Button>
            </AiPromptModal>
            <Button type="button" variant="ghost" disabled={isLoading} onClick={handleSaveDraft}>
              Save draft
            </Button>
            <Button type="button" disabled={!canSave || isLoading} onClick={() => setPublishModalOpen(true)}>
              <Send /> Publish
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* Question rail: on top on phones, a column from md */}
          <aside className="flex max-h-[38vh] shrink-0 flex-col border-b border-sidebar-border bg-sidebar md:max-h-none md:w-60 md:border-b-0 md:border-r">
            <div className="flex h-11 shrink-0 items-center justify-between px-4">
              <p id="poll-questions-heading" className="text-sm font-medium text-foreground">Questions</p>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{questions.length}</span>
            </div>

            <ol aria-labelledby="poll-questions-heading" className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
              {questions.map((q, i) => {
                const active = activeIndex === i;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setActiveIndex(i)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                        active
                          ? "border-border bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.06)]"
                          : "border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      )}
                    >
                      <span className={cn("w-4 shrink-0 pt-px font-mono text-xs tabular-nums", active ? "text-accent-ink" : "text-muted-foreground")}>
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-sm leading-snug">{previewLabel(q.text, i + 1)}</span>
                        {q.isMandatory ? <span className="mt-0.5 block text-xs text-muted-foreground">Required</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="shrink-0 space-y-3 border-t border-sidebar-border p-3">
              <Button type="button" variant="outline" onClick={addQuestion} className="w-full border-dashed bg-card">
                <Plus /> Add question
              </Button>
              <div>
                <p className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>Ready to publish</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {completedCount} of {questions.length}
                  </span>
                </p>
                <div className="h-1 overflow-hidden rounded-full bg-secondary">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    animate={{ width: `${questions.length > 0 ? (completedCount / questions.length) * 100 : 0}%` }}
                    transition={{ duration: 0.5, ease }}
                  />
                </div>
              </div>
            </div>
          </aside>

          {/* Editor on graph paper */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
            <div className="relative mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6 lg:py-10">
              <AnimatePresence mode="wait">
                {activeQuestion && (
                  <PollQuestionCard
                    key={activeIndex}
                    question={activeQuestion}
                    index={activeIndex}
                    canRemove={questions.length > 1}
                    pollType={pollType}
                    onRemove={() => removeQuestion(activeIndex)}
                    onChange={(patch) => updateQuestion(activeIndex, patch)}
                    onOptionChange={(oi, v) => updateOption(activeIndex, oi, v)}
                    onAddOption={() => addOption(activeIndex)}
                    onRemoveOption={(oi) => removeOption(activeIndex, oi)}
                  />
                )}
              </AnimatePresence>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={activeIndex === 0}
                  onClick={() => setActiveIndex((i) => i - 1)}
                >
                  <ChevronLeft /> Previous
                </Button>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {activeIndex + 1} / {questions.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={activeIndex === questions.length - 1}
                  onClick={() => setActiveIndex((i) => i + 1)}
                >
                  Next <ChevronRight />
                </Button>
              </div>
            </div>
          </div>

          {/* Respondent preview */}
          <aside className="hidden w-80 shrink-0 items-center justify-center overflow-y-auto border-l border-border bg-background p-6 xl:flex">
            <LivePreview
              question={activeQuestion}
              questionIndex={activeIndex}
              totalQuestions={questions.length}
              pollTitle={title}
            />
          </aside>
        </div>
      </div>

      <PublishSettingsModal
        open={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        onConfirm={handleSave}
        isLoading={isLoading}
        expiresAtLocal={expiresAtLocal}
        onExpiresChange={setExpiresAtLocal}
        isAnonymous={isAnonymous}
        onAnonymousChange={setIsAnonymous}
        isPublished={isPublished}
        onPublishedChange={setIsPublished}
        pollTitle={title}
        pollType={pollType}
        onPollTypeChange={setPollType}
        passingScorePercentage={passingScorePercentage}
        onPassingScorePercentageChange={setPassingScorePercentage}
        questions={questions}
      />
    </>
  );
}
