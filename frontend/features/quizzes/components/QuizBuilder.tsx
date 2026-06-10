"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Keyboard,
  ListChecks,
  Loader2,
  Plus,
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
import { createQuiz, getQuiz, updateQuiz } from "../api/quizApi";
import type { QuizSlide, QuizSlideType } from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

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
  timeLimit: 30,
  points: 1000,
  scoreDependsOnTime: true,
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
    } else if (s.acceptedAnswers.length === 0) {
      return `Slide ${i + 1}: add at least one accepted answer.`;
    }
  }
  return null;
}

export function QuizBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");

  const [title, setTitle] = useState("");
  const [slides, setSlides] = useState<QuizSlide[]>([blankSlide()]);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [acceptedDraft, setAcceptedDraft] = useState("");

  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        const quiz = await getQuiz(editId);
        setTitle(quiz.title);
        setSlides(quiz.slides);
      } catch {
        toast.error("Could not load quiz for editing.");
        router.push("/quizzes");
      } finally {
        setLoading(false);
      }
    })();
  }, [editId, router]);

  const slide = slides[active] ?? slides[0];

  const patchSlide = (patch: Partial<QuizSlide>) => {
    setSlides((prev) => prev.map((s, i) => (i === active ? { ...s, ...patch } : s)));
  };

  const switchType = (type: QuizSlideType) => {
    if (slide.type === type) return;
    patchSlide(
      type === "select_answer"
        ? {
            type,
            options:
              slide.options.length >= 2
                ? slide.options
                : [
                    { text: "", isCorrect: true },
                    { text: "", isCorrect: false },
                  ],
          }
        : { type }
    );
  };

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
    const cleaned = slides.map((s) => ({
      ...s,
      question: s.question.trim(),
      options: s.type === "select_answer" ? s.options.filter((o) => o.text.trim()) : [],
      acceptedAnswers: s.type === "type_answer" ? s.acceptedAnswers : [],
    }));

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
      router.push("/quizzes");
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
            Quiz Competition
          </p>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled quiz"
            className="border-none bg-transparent px-0 text-2xl font-bold tracking-tight focus-visible:ring-0 placeholder:text-muted-foreground/30"
          />
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6 hover:bg-primary/90"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : editId ? "Save changes" : "Create quiz"}
        </Button>
      </motion.div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Slide rail */}
        <div className="lg:w-52 shrink-0 space-y-2">
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`w-full text-left rounded-2xl border px-3 py-2.5 transition-all duration-300 ${
                i === active
                  ? "border-primary/40 bg-primary/10 ring-1 ring-yellow-400/30"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-muted-foreground/50 tabular-nums">
                  {i + 1}
                </span>
                {s.type === "select_answer" ? (
                  <ListChecks className="size-3 text-primary/60" />
                ) : (
                  <Keyboard className="size-3 text-orange-400/70" />
                )}
                <span className="flex-1 truncate text-xs font-medium text-foreground/80">
                  {s.question.trim() || "Untitled slide"}
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
          ))}
          <Button
            variant="outline"
            onClick={() => {
              setSlides((prev) => [...prev, blankSlide()]);
              setActive(slides.length);
            }}
            className="w-full rounded-2xl border-dashed border-white/15 bg-transparent text-xs text-muted-foreground/70 hover:text-foreground"
          >
            <Plus className="size-3.5 mr-1" /> Add slide
          </Button>
        </div>

        {/* Editor */}
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="flex-1 p-1.5 rounded-[2rem] bg-white/5 border border-white/10"
        >
          <div className="rounded-[calc(2rem-0.375rem)] bg-card p-6 space-y-6">
            {/* Type toggle */}
            <div className="flex gap-2">
              {(
                [
                  { type: "select_answer", label: "Select Answer", Icon: ListChecks },
                  { type: "type_answer", label: "Type Answer", Icon: Keyboard },
                ] as const
              ).map(({ type, label, Icon }) => (
                <button
                  key={type}
                  onClick={() => switchType(type)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all duration-300 border ${
                    slide.type === type
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-white/[0.03] text-muted-foreground border-white/10 hover:bg-white/[0.08]"
                  }`}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>

            {/* Question */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Question
              </Label>
              <Textarea
                value={slide.question}
                onChange={(e) => patchSlide({ question: e.target.value })}
                placeholder="Ask something…"
                className="min-h-20 rounded-2xl bg-secondary/15 border-border/40 text-base"
              />
            </div>

            {/* Answers */}
            {slide.type === "select_answer" ? (
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
            ) : (
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

            {/* Timing & scoring */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-white/5">
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
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
