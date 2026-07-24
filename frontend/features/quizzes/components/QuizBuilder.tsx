"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createQuiz, generateQuizDraft, getQuiz, updateQuiz } from "../api/quizApi";
import { slideTypeMeta } from "../slideTypeMeta";
import { AiQuizModal } from "./AiQuizModal";
import { SlideTypePicker } from "./SlideTypePicker";
import { isScoredSlideType, type GeneratedQuizDraft, type QuizSlide, type QuizSlideType } from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

const buildDraftStorageKey = (quizId: string | null) =>
  quizId ? `openpoll_quiz_draft_${quizId}` : "openpoll_quiz_draft_new";

type PersistedQuizDraft = {
  title: string;
  slides: QuizSlide[];
  active: number;
};

function loadDraft(storageKey: string): PersistedQuizDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedQuizDraft;
    if (!parsed || typeof parsed.title !== "string" || !Array.isArray(parsed.slides)) {
      return null;
    }
    return {
      title: parsed.title,
      slides: parsed.slides,
      active: typeof parsed.active === "number" ? parsed.active : 0,
    };
  } catch {
    return null;
  }
}

function saveDraft(storageKey: string, draft: PersistedQuizDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Ignore storage quota or private-mode failures.
  }
}

function clearDraft(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures.
  }
}

const blankSlide = (type: QuizSlideType = "select_answer"): QuizSlide => ({
  type,
  question: "",
  options:
    type === "select_answer"
      ? [
          { text: "", isCorrect: true },
          { text: "", isCorrect: false },
        ]
      : [],
  acceptedAnswers: [],
  statements: type === "scales" ? [""] : [],
  minLabel: type === "scales" ? "Disagree" : "",
  maxLabel: type === "scales" ? "Agree" : "",
  scaleMax: 5,
  items: type === "ranking" ? ["", ""] : [],
  maxEntries: 3,
  timeLimit: type === "open_ended" ? 60 : 30,
  points: isScoredSlideType(type) ? 1000 : 0,
  scoreDependsOnTime: isScoredSlideType(type),
});

function validateSlides(title: string, slides: QuizSlide[]): string | null {
  if (!title.trim()) return "Give your quiz a title.";
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (!s.question.trim()) return `Slide ${i + 1}: question text is missing.`;
    if (s.type === "select_answer") {
      const filled = s.options.filter((o) => o.text.trim());
      if (filled.length < 2) return `Slide ${i + 1}: needs at least 2 options.`;
      if (!filled.some((o) => o.isCorrect)) return `Slide ${i + 1}: mark a correct option.`;
    } else if (s.type === "type_answer" && s.acceptedAnswers.length === 0) {
      return `Slide ${i + 1}: add at least one accepted answer.`;
    } else if (s.type === "scales" && s.statements.filter((st) => st.trim()).length === 0) {
      return `Slide ${i + 1}: add at least one statement.`;
    } else if (s.type === "ranking" && s.items.filter((it) => it.trim()).length < 2) {
      return `Slide ${i + 1}: ranking needs at least 2 items.`;
    }
  }
  return null;
}

/** Zero out fields that don't belong to the slide's type before saving */
function cleanSlide(s: QuizSlide): QuizSlide {
  return {
    ...s,
    question: s.question.trim(),
    options: s.type === "select_answer" ? s.options.filter((o) => o.text.trim()) : [],
    acceptedAnswers: s.type === "type_answer" ? s.acceptedAnswers : [],
    statements: s.type === "scales" ? s.statements.filter((st) => st.trim()) : [],
    minLabel: s.type === "scales" ? s.minLabel : "",
    maxLabel: s.type === "scales" ? s.maxLabel : "",
    items: s.type === "ranking" ? s.items.filter((it) => it.trim()) : [],
    points: isScoredSlideType(s.type) ? s.points : 0,
    scoreDependsOnTime: isScoredSlideType(s.type) ? s.scoreDependsOnTime : false,
  };
}

export function QuizBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const seedName = searchParams.get("name");
  const seedMode = searchParams.get("mode");

  const [title, setTitle] = useState(seedName ?? "");
  const [slides, setSlides] = useState<QuizSlide[]>([blankSlide()]);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [acceptedDraft, setAcceptedDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const aiAutoOpened = useRef(false);
  const draftStorageKey = useMemo(() => buildDraftStorageKey(editId), [editId]);
  const draftHydratedRef = useRef(false);
  const draftDirtyRef = useRef(false);

  useEffect(() => {
    const saved = loadDraft(draftStorageKey);
    if (saved) {
      setTitle(saved.title);
      setSlides(saved.slides.length > 0 ? saved.slides : [blankSlide()]);
      setActive(Math.min(saved.active, Math.max(0, saved.slides.length - 1)));
    }
    draftHydratedRef.current = true;
  }, [draftStorageKey]);

  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        const quiz = await getQuiz(editId);
        setTitle(quiz.title);
        setSlides(quiz.slides);
      } catch {
        toast.error("Could not load quiz for editing.");
        router.push("/polls");
      } finally {
        setLoading(false);
      }
    })();
  }, [editId, router]);

  // Arriving from the create modal in AI mode opens the prompt straight away
  useEffect(() => {
    if (seedMode === "ai" && !editId && !aiAutoOpened.current) {
      aiAutoOpened.current = true;
      setAiOpen(true);
    }
  }, [seedMode, editId]);

  const slide = slides[active] ?? slides[0];
  const meta = slideTypeMeta(slide.type);
  const scored = isScoredSlideType(slide.type);

  const patchSlide = (patch: Partial<QuizSlide>) => {
    setSlides((prev) => prev.map((s, i) => (i === active ? { ...s, ...patch } : s)));
  };

  const addSlide = (type: QuizSlideType) => {
    setSlides((prev) => [...prev, blankSlide(type)]);
    setActive(slides.length);
    setPickerOpen(false);
  };

  const handleGenerated = (draft: GeneratedQuizDraft) => {
    if (!title.trim() && draft.title) setTitle(draft.title);
    setSlides(draft.slides.map((s) => ({ ...blankSlide(s.type), ...s })));
    setActive(0);
  };

  const handleAiGenerate = async (params: { topic: string; slideCount: number; slideTypes: QuizSlideType[] }) => {
    setIsAiGenerating(true);
    const toastId = toast.loading("AI is drafting your quiz slides...");
    try {
      const draft = await generateQuizDraft(params);
      handleGenerated(draft);
      toast.success(`Generated ${draft.slides.length} slides — review and tweak before saving.`, { id: toastId });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "AI quiz generation failed.", { id: toastId });
    } finally {
      setIsAiGenerating(false);
    }
  };

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (editId === null && !title.trim() && slides.length === 1 && !slides[0]?.question.trim()) {
      return;
    }

    draftDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      saveDraft(draftStorageKey, { title, slides, active });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [title, slides, active, draftStorageKey, editId]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (!draftDirtyRef.current) return;
      saveDraft(draftStorageKey, { title, slides, active });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (draftDirtyRef.current) {
        saveDraft(draftStorageKey, { title, slides, active });
      }
    };
  }, [draftStorageKey, title, slides, active]);

  const addAcceptedAnswer = () => {
    const value = acceptedDraft.trim();
    if (!value) return;
    if (slide.acceptedAnswers.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setAcceptedDraft("");
      return;
    }
    patchSlide({ acceptedAnswers: [...slide.acceptedAnswers, value] });
    setAcceptedDraft("");
  };

  const handleSave = async () => {
    const cleaned = slides.map(cleanSlide);

    const error = validateSlides(title, cleaned);
    if (error) {
      toast.error(error);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        slides: cleaned.map(({ _id, ...rest }) => rest),
      };
      if (editId) {
        await updateQuiz(editId, payload);
        toast.success("Quiz updated!");
      } else {
        await createQuiz(payload);
        toast.success("Quiz created!");
      }
      clearDraft(draftStorageKey);
      router.push("/polls");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save quiz.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-primary/60" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease }}
        className="flex flex-col md:flex-row md:items-center gap-4"
      >
        <div className="flex-1 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
            Quiz Builder
          </p>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled quiz"
            className="border-none bg-transparent px-0 text-2xl font-bold tracking-tight focus-visible:ring-0 placeholder:text-muted-foreground/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={isAiGenerating}
            onClick={() => setAiOpen(true)}
            className={cn(
              "h-11 rounded-full px-5 font-semibold transition-all duration-300",
              isAiGenerating
                ? "animate-ai-glow border-primary text-primary"
                : "border-primary/25 text-primary hover:bg-primary/10 hover:shadow-[0_0_20px_rgba(216,173,135,0.4)]"
            )}
          >
            <Sparkles className={cn("size-4 mr-2 transition-transform duration-200", isAiGenerating && "animate-spin")} />
            {isAiGenerating ? "Generating..." : "AI generate"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6 hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : editId ? "Save changes" : "Create quiz"}
          </Button>
        </div>
      </motion.div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Slide rail */}
        <div className="lg:w-56 shrink-0 space-y-2">
          {slides.map((s, i) => {
            const m = slideTypeMeta(s.type);
            return (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`w-full text-left rounded-2xl border px-3 py-2.5 transition-all duration-300 ${
                  i === active
                    ? "border-primary/40 bg-primary/10 ring-1 ring-yellow-400/30"
                    : "border-white/10 bg-white/3 hover:bg-white/6"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground/50 tabular-nums">
                    {i + 1}
                  </span>
                  <m.Icon className={`size-3 ${m.iconClass}`} />
                  <span className="flex-1 truncate text-xs font-medium text-foreground/80">
                    {s.question.trim() || m.label}
                  </span>
                  {slides.length > 1 && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlides((prev) => prev.filter((_, j) => j !== i));
                        setActive((prev) => Math.max(0, prev > i ? prev - 1 : Math.min(prev, slides.length - 2)));
                      }}
                      className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="size-3" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Add slide → Mentimeter-style type picker */}
          <div className="relative">
            <Button
              variant="outline"
              onClick={() => setPickerOpen((v) => !v)}
              className="w-full rounded-2xl border-dashed border-white/15 bg-transparent text-xs text-muted-foreground/70 hover:text-foreground"
            >
              <Plus className="size-3.5 mr-1" /> New slide
            </Button>
            <SlideTypePicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onPick={addSlide}
            />
          </div>
        </div>

        {/* Editor */}
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="flex-1 p-1.5 rounded-[2rem] bg-white/5 border border-white/10"
        >
          <div className="rounded-[1.625rem] bg-card p-6 space-y-6">
            {/* Type badge */}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/4 border border-white/10 px-4 py-2 text-xs font-semibold text-foreground/85">
                <meta.Icon className={`size-3.5 ${meta.iconClass}`} /> {meta.label}
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 ml-1">
                  {scored ? "Scored" : "Interactive"}
                </span>
              </span>
            </div>

            {/* Question */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Question
              </Label>
              <Textarea
                value={slide.question}
                onChange={(e) => patchSlide({ question: e.target.value })}
                placeholder={
                  slide.type === "wordcloud"
                    ? "e.g. Describe today's session in one word"
                    : slide.type === "ranking"
                      ? "e.g. Rank these features by importance"
                      : "Ask something…"
                }
                className="min-h-20 rounded-2xl bg-secondary/15 border-border/40 text-base"
              />
            </div>

            {/* Per-type editors */}
            {slide.type === "select_answer" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Options — tap the circle to mark correct
                </Label>
                <div className="space-y-2">
                  {slide.options.map((option, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          patchSlide({
                            options: slide.options.map((o, j) =>
                              j === i ? { ...o, isCorrect: !o.isCorrect } : o
                            ),
                          })
                        }
                        title="Mark correct"
                        className="shrink-0"
                      >
                        {option.isCorrect ? (
                          <CheckCircle2 className="size-5 text-emerald-400" />
                        ) : (
                          <Circle className="size-5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors" />
                        )}
                      </button>
                      <Input
                        value={option.text}
                        onChange={(e) =>
                          patchSlide({
                            options: slide.options.map((o, j) =>
                              j === i ? { ...o, text: e.target.value } : o
                            ),
                          })
                        }
                        placeholder={`Option ${i + 1}`}
                        className="h-10 rounded-xl bg-secondary/15 border-border/40"
                      />
                      {slide.options.length > 2 && (
                        <button
                          onClick={() =>
                            patchSlide({ options: slide.options.filter((_, j) => j !== i) })
                          }
                          className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {slide.options.length < 8 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patchSlide({ options: [...slide.options, { text: "", isCorrect: false }] })
                    }
                    className="text-xs text-muted-foreground/70 hover:text-foreground"
                  >
                    <Plus className="size-3.5 mr-1" /> Add option
                  </Button>
                )}
              </div>
            )}

            {slide.type === "type_answer" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Accepted answers (case-insensitive)
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={acceptedDraft}
                    onChange={(e) => setAcceptedDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addAcceptedAnswer();
                      }
                    }}
                    placeholder="Type an answer and press Enter"
                    className="h-10 rounded-xl bg-secondary/15 border-border/40"
                  />
                  <Button variant="outline" onClick={addAcceptedAnswer} className="rounded-xl">
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {slide.acceptedAnswers.map((answer, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400"
                    >
                      {answer}
                      <button
                        onClick={() =>
                          patchSlide({
                            acceptedAnswers: slide.acceptedAnswers.filter((_, j) => j !== i),
                          })
                        }
                        className="hover:text-red-400 transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {slide.type === "wordcloud" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Entries per participant
                </Label>
                <div className="flex gap-2">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => patchSlide({ maxEntries: n })}
                      className={`size-10 rounded-xl border text-sm font-bold transition-all ${
                        slide.maxEntries === n
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-white/10 bg-white/3 text-muted-foreground hover:bg-white/8"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground/50">
                  Repeated words grow bigger in the live cloud.
                </p>
              </div>
            )}

            {slide.type === "open_ended" && (
              <p className="text-xs text-muted-foreground/50 rounded-2xl border border-white/5 bg-white/2 px-4 py-3">
                Participants type a free-form response. Answers show up as a card wall on the
                presenter screen — duplicates are grouped with a counter.
              </p>
            )}

            {slide.type === "scales" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Statements to rate (1–{slide.scaleMax})
                  </Label>
                  <div className="space-y-2">
                    {slide.statements.map((statement, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={statement}
                          onChange={(e) =>
                            patchSlide({
                              statements: slide.statements.map((s, j) =>
                                j === i ? e.target.value : s
                              ),
                            })
                          }
                          placeholder={`Statement ${i + 1}`}
                          className="h-10 rounded-xl bg-secondary/15 border-border/40"
                        />
                        {slide.statements.length > 1 && (
                          <button
                            onClick={() =>
                              patchSlide({
                                statements: slide.statements.filter((_, j) => j !== i),
                              })
                            }
                            className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {slide.statements.length < 10 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => patchSlide({ statements: [...slide.statements, ""] })}
                      className="text-xs text-muted-foreground/70 hover:text-foreground"
                    >
                      <Plus className="size-3.5 mr-1" /> Add statement
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Low label
                    </Label>
                    <Input
                      value={slide.minLabel}
                      onChange={(e) => patchSlide({ minLabel: e.target.value })}
                      placeholder="Disagree"
                      className="h-10 rounded-xl bg-secondary/15 border-border/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                      High label
                    </Label>
                    <Input
                      value={slide.maxLabel}
                      onChange={(e) => patchSlide({ maxLabel: e.target.value })}
                      placeholder="Agree"
                      className="h-10 rounded-xl bg-secondary/15 border-border/40"
                    />
                  </div>
                </div>
              </div>
            )}

            {slide.type === "ranking" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Items to rank
                </Label>
                <div className="space-y-2">
                  {slide.items.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-muted-foreground/40 tabular-nums w-4 text-right">
                        {i + 1}
                      </span>
                      <Input
                        value={item}
                        onChange={(e) =>
                          patchSlide({
                            items: slide.items.map((it, j) => (j === i ? e.target.value : it)),
                          })
                        }
                        placeholder={`Item ${i + 1}`}
                        className="h-10 rounded-xl bg-secondary/15 border-border/40"
                      />
                      {slide.items.length > 2 && (
                        <button
                          onClick={() =>
                            patchSlide({ items: slide.items.filter((_, j) => j !== i) })
                          }
                          className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {slide.items.length < 10 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patchSlide({ items: [...slide.items, ""] })}
                    className="text-xs text-muted-foreground/70 hover:text-foreground"
                  >
                    <Plus className="size-3.5 mr-1" /> Add item
                  </Button>
                )}
              </div>
            )}

            {/* Timing & scoring */}
            <div
              className={`grid grid-cols-1 gap-4 pt-2 border-t border-white/5 ${
                scored ? "md:grid-cols-3" : "md:grid-cols-2"
              }`}
            >
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                  <Timer className="size-3.5 text-primary/70" /> Time limit (s)
                </Label>
                <Input
                  type="number"
                  min={5}
                  max={300}
                  value={slide.timeLimit}
                  onChange={(e) =>
                    patchSlide({
                      timeLimit: Math.min(300, Math.max(5, Number(e.target.value) || 5)),
                    })
                  }
                  className="h-10 rounded-xl bg-secondary/15 border-border/40 tabular-nums"
                />
              </div>
              {scored ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                      <Trophy className="size-3.5 text-primary/70" /> Max points
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      step={100}
                      value={slide.points}
                      onChange={(e) =>
                        patchSlide({
                          points: Math.min(10000, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      className="h-10 rounded-xl bg-secondary/15 border-border/40 tabular-nums"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Faster = more points
                    </Label>
                    <div className="flex items-center gap-3 h-10">
                      <Switch
                        checked={slide.scoreDependsOnTime}
                        onCheckedChange={(checked) => patchSlide({ scoreDependsOnTime: checked })}
                      />
                      <span className="text-xs text-muted-foreground/60">
                        {slide.scoreDependsOnTime
                          ? "Speed bonus on (down to 50%)"
                          : "Flat points for correct"}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Scoring
                  </Label>
                  <p className="text-xs text-muted-foreground/50 h-10 flex items-center">
                    Interactive slide — no points, leaderboard unaffected.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      <AiQuizModal
        open={aiOpen}
        onOpenChange={setAiOpen}
        initialTopic={title}
        onGenerated={handleGenerated}
        onGenerate={handleAiGenerate}
        isGenerating={isAiGenerating}
      />
    </div>
  );
}
