"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ListPlus,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";

import { defaultDatetimeLocal, toDatetimeLocalValue } from "@/features/polls/components/create/datetime";
import { PollQuestionCard } from "@/features/polls/components/create/PollQuestionCard";
import { PublishSettingsModal } from "@/features/polls/components/create/PublishSettingsModal";
import type { QuestionForm } from "@/features/polls/components/create/types";
import { useCreatorStore } from "@/features/polls/store/useCreatorStore";
import { type AiTone, defaultAiExpiresAtIso, generateDraft, type GeneratedPollDraft } from "@/features/ai/api/generateDraft";
import { AiPromptModal } from "@/features/ai/components/AiPromptModal";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api-client";
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

export function PollBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { createPoll, updatePoll, polls, fetchPolls, isLoading } = useCreatorStore();

  // Pre-fill title from query param set by CreatePollModal
  const nameFromUrl = searchParams.get("name") ?? "";
  const modeFromUrl = searchParams.get("mode") ?? "manual"; // "ai" | "manual"
  const draftIdFromUrl = searchParams.get("draftId");

  const [title, setTitle] = useState(nameFromUrl);
  const [expiresAtLocal, setExpiresAtLocal] = useState(defaultDatetimeLocal);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isPublished, setIsPublished] = useState(true);
  const [questions, setQuestions] = useState<QuestionForm[]>(() => [emptyQuestion()]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [isDraftLoaded, setIsDraftLoaded] = useState(!draftIdFromUrl);

  useEffect(() => {
    if (draftIdFromUrl) {
      const poll = polls.find(p => p._id === draftIdFromUrl);
      if (poll) {
        setTitle(poll.title);
        setIsAnonymous(poll.isAnonymous);
        setIsPublished(poll.isPublished);
        setExpiresAtLocal(toDatetimeLocalValue(poll.expiresAt));
        setQuestions(
          poll.questions.map((q) => {
            const opts = [...q.options];
            while (opts.length < 2) opts.push("");
            return { _id: q._id, text: q.text, isMandatory: q.isMandatory, options: opts };
          })
        );
        setIsDraftLoaded(true);
      } else {
        // If not found, maybe it hasn't been fetched yet
        fetchPolls().catch(() => {});
      }
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
      expiresAtLocal,
      isAnonymous,
      questions,
      draftIdFromUrl,
      isDraftLoaded,
      isPublished,
      nameFromUrl
    };
  }, [title, expiresAtLocal, isAnonymous, questions, draftIdFromUrl, isDraftLoaded, isPublished, nameFromUrl]);

  const isExplicitSaveRef = useRef(false);
  const isSavingRef = useRef(false);

  // Sync title with URL if it's a new poll and title hasn't been edited
  useEffect(() => {
    if (!draftIdFromUrl && nameFromUrl) {
      setTitle(nameFromUrl);
    }
  }, [nameFromUrl, draftIdFromUrl]);

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
          let text = q.text.trim() || "Untitled Question";
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
          expiresAt: expiresAt,
          isAnonymous: s.isAnonymous,
          isPublished: false, // Save as draft
          questions: finalQuestions.map((q) => ({
            _id: q._id,
            text: q.text,
            isMandatory: q.isMandatory,
            options: q.options,
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


  async function handleAiGenerate(params: { topic: string; tone: AiTone; questionCount: number }) {
    setIsAiGenerating(true);
    const toastId = toast.loading("AI is shaping your questions...");
    try {
      const draft = await generateDraft({
        ...params,
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
    setQuestions((prev) => {
      const newQuestions: QuestionForm[] = draft.questions.map((q) => {
        const opts = [...q.options];
        while (opts.length < 2) opts.push("");
        return { text: q.text, isMandatory: q.isMandatory, options: opts };
      });

      // If we only have one empty question, replace it. Otherwise, append.
      const isInitialEmpty =
        prev.length === 1 &&
        !prev[0].text.trim() &&
        prev[0].options.every((o) => !o.trim());

      return isInitialEmpty ? newQuestions : [...prev, ...newQuestions];
    });

    setAiTrigger(false);
    toast.success("AI questions added to your poll!");
  }, []);

  const canSave = useMemo(() => {
    if (title.trim().length < 3) return false;
    if (!expiresAtLocal) return false;
    const exp = new Date(expiresAtLocal).getTime();
    // Allow if it's not more than 2 minutes in the past (buffer for user interaction)
    if (Number.isNaN(exp) || exp < nowMs - 120_000) return false;
    if (questions.length === 0) return false;
    return questions.every((q) => {
      const opts = q.options.map((o) => o.trim()).filter(Boolean);
      return q.text.trim().length >= 3 && opts.length >= 2;
    });
  }, [title, expiresAtLocal, questions, nowMs]);

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
        return { ...q, options: q.options.filter((_, j) => j !== optIndex) };
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
        let text = q.text.trim() || "Untitled Question";
        let opts = q.options.map((o) => o.trim()).filter(Boolean);
        if (opts.length === 0) opts = ["Option 1", "Option 2"];
        else if (opts.length === 1) opts.push("Option 2");
        return { ...q, text, options: opts };
      });

      const payload = {
        title: finalTitle,
        expiresAt: new Date(expiresAtLocal).toISOString(),
        isAnonymous,
        isPublished: false,
        questions: finalQuestions.map((q) => ({
          _id: q._id,
          text: q.text,
          isMandatory: q.isMandatory,
          options: q.options,
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
        expiresAt: new Date(expiresAtLocal).toISOString(),
        isAnonymous,
        isPublished,
        questions: questions.map((q) => ({
          _id: q._id,
          text: q.text.trim(),
          isMandatory: q.isMandatory,
          options: q.options.map((o) => o.trim()).filter(Boolean),
        })),
      };

      if (draftIdFromUrl) {
        await updatePoll(draftIdFromUrl, payload);
      } else {
        await createPoll(payload);
      }
      
      setPublishModalOpen(false);
      toast.success(isPublished ? "Poll published!" : "Poll saved as draft!");
      router.push("/polls");
    } catch {
      isExplicitSaveRef.current = false; // Release lock on failure
      toast.error("Could not save poll. Try again.");
    } finally {
      isSavingRef.current = false;
    }
  }

  const activeQuestion = questions[activeIndex] ?? null;
  const completedCount = questions.filter(
    (q) => q.text.trim().length >= 3 && q.options.filter((o) => o.trim()).length >= 2
  ).length;

  if (!isDraftLoaded) {
    return <div className="flex h-screen items-center justify-center bg-background text-foreground">Loading draft...</div>;
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
        {/* Route chrome + title + actions (single bar, matches dashboard pages) */}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border/40 bg-background/80 px-4 backdrop-blur-xl md:gap-4 md:px-6 relative overflow-hidden">
          {/* Top primary edge glow */}
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          
          <div className="hidden min-w-0 shrink-0 sm:block relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Open Poll</p>
            <h1 className="truncate text-sm font-semibold text-foreground/90">Create Poll</h1>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Poll title"
            className="min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-semibold text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-0 truncate"
            aria-label="Poll title"
          />
          <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
            <AiPromptModal
              isAnonymous={isAnonymous}
              onGenerate={handleAiGenerate}
              externalOpen={aiTrigger}
              onExternalOpenChange={setAiTrigger}
              initialTopic={title}
              isGenerating={isAiGenerating}
            >
              <button
                type="button"
                disabled={isAiGenerating}
                className={cn(
                  "group flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs font-semibold transition-all duration-300 active:scale-95 md:px-2.5",
                  isAiGenerating
                    ? "animate-ai-glow border-primary text-primary"
                    : "border-primary/40 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_20px_rgba(216,173,135,0.4)]"
                )}
              >
                <Sparkles className={cn("size-3 transition-transform duration-200", !isAiGenerating && "group-hover:rotate-12", isAiGenerating && "animate-spin")} />
                <span className="hidden lg:inline">{isAiGenerating ? "Generating..." : "Generate with AI"}</span>
              </button>
            </AiPromptModal>
            <button
              type="button"
              onClick={() => router.push("/polls")}
              className="flex size-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary/50 hover:text-foreground/80 transition-all"
              aria-label="Back to polls"
            >
              <X className="size-4" />
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={handleSaveDraft}
              className="group flex items-center gap-1.5 rounded-xl border border-border bg-secondary/30 px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95 md:px-3"
            >
              <Save className="size-3.5 transition-transform duration-200 group-hover:-rotate-12" />
              <span className="hidden sm:inline">Save Draft</span>
            </button>
            <button
              type="button"
              disabled={!canSave || isLoading}
              onClick={() => setPublishModalOpen(true)}
              className={cn(
                "flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold transition-all duration-300 active:scale-95 md:gap-1.5 md:px-3 md:text-sm",
                canSave && !isLoading
                  ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(216,173,135,0.3)] hover:opacity-90 hover:shadow-[0_0_25px_rgba(216,173,135,0.5)]"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              )}
            >
              <Send className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">Publish</span>
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-row overflow-hidden relative">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

          <aside className="flex w-40 shrink-0 flex-col overflow-hidden border-r border-border/50 bg-[#0d0b09]/80 backdrop-blur-xl sm:w-44 xl:w-52 relative z-10">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 px-2.5 sm:h-14 sm:px-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-primary/80">Questions</p>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                {questions.length}
              </span>
            </div>

            <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-1.5">
              {questions.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={cn(
                    "group relative w-full rounded-xl px-2 py-2 text-left transition-all duration-200 sm:px-2.5",
                    activeIndex === i
                      ? "bg-primary/[0.1] ring-1 ring-primary/30"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground/70"
                  )}
                >
                  {activeIndex === i && (
                    <motion.div
                      layoutId="qBar"
                      className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-primary"
                    />
                  )}
                  <div className="flex items-start gap-2 pl-0.5 relative z-10">
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-bold tabular-nums shadow-sm transition-all duration-300",
                        activeIndex === i ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(216,173,135,0.5)]" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {i + 1}
                    </span>
                    <p
                      className={cn(
                        "line-clamp-2 text-[10px] leading-snug transition-colors duration-300",
                        activeIndex === i ? "text-primary font-medium" : "text-muted-foreground"
                      )}
                    >
                      {previewLabel(q.text, i + 1)}
                    </p>
                  </div>
                  {q.isMandatory && (
                    <span className="ml-6 mt-1 inline-block rounded-full bg-primary/15 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wide text-primary/80">
                      Required
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="shrink-0 border-t border-border p-1.5">
              <button
                type="button"
                onClick={addQuestion}
                className="group flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-[10px] font-semibold text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/[0.06] hover:text-primary/90"
              >
                <ListPlus className="size-3.5" />
                Add question
              </button>
            </div>

            <div className="shrink-0 border-t border-border/50 bg-[#0d0b09]/80 px-2.5 py-2 sm:px-3 sm:py-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[8px] font-bold uppercase tracking-widest text-primary/70">Progress</span>
                <span className="text-[8px] font-bold text-primary">
                  {completedCount}/{questions.length}
                </span>
              </div>
              <div className="h-0.5 overflow-hidden rounded-full bg-primary/10">
                <motion.div
                  className="h-full rounded-full bg-primary shadow-[0_0_10px_rgba(216,173,135,0.8)]"
                  animate={{ width: `${questions.length > 0 ? (completedCount / questions.length) * 100 : 0}%` }}
                  transition={{ duration: 0.5, ease }}
                />
              </div>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="custom-scrollbar flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-xl space-y-8 px-4 py-6 sm:px-5 sm:py-8">
          

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/30" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-primary">
                    Question {activeIndex + 1}
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/30" />
                </div>

                <AnimatePresence mode="wait">
                  {activeQuestion && (
                    <PollQuestionCard
                      key={activeIndex}
                      question={activeQuestion}
                      index={activeIndex}
                      canRemove={questions.length > 1}
                      onRemove={() => removeQuestion(activeIndex)}
                      onChange={(patch) => updateQuestion(activeIndex, patch)}
                      onOptionChange={(oi, v) => updateOption(activeIndex, oi, v)}
                      onAddOption={() => addOption(activeIndex)}
                      onRemoveOption={(oi) => removeOption(activeIndex, oi)}
                    />
                  )}
                </AnimatePresence>

                <div className="flex items-center justify-between border-t border-white/[0.08] pt-4">
                  <button
                    type="button"
                    disabled={activeIndex === 0}
                    onClick={() => setActiveIndex((i) => i - 1)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground/75 disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <ChevronLeft className="size-4" /> Previous
                  </button>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {activeIndex + 1} / {questions.length}
                  </span>
                  <button
                    type="button"
                    disabled={activeIndex === questions.length - 1}
                    onClick={() => setActiveIndex((i) => i + 1)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground/75 disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    Next <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
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
      />
    </>
  );
}
