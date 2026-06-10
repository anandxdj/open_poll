"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Copy,
  Layers,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteQuiz, listQuizzes } from "@/features/quizzes/api/quizApi";
import type { Quiz, QuizStatus } from "@/features/quizzes/types";

const ease = [0.32, 0.72, 0, 1] as const;

const statusChip: Record<QuizStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-white/5 text-white/50 border-white/10" },
  lobby: { label: "Lobby open", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  question: { label: "Live", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  reveal: { label: "Live", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  leaderboard: { label: "Live", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  ended: { label: "Ended", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
};

export default function QuizzesPage() {
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setQuizzes(await listQuizzes());
      } catch {
        toast.error("Could not load quizzes.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (quiz: Quiz) => {
    if (!window.confirm(`Delete "${quiz.title}"? This removes all results.`)) return;
    try {
      await deleteQuiz(quiz._id);
      setQuizzes((prev) => prev.filter((q) => q._id !== quiz._id));
      toast.success("Quiz deleted.");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to delete quiz.");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto w-full space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease }}
        className="flex items-center justify-between"
      >
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
            Quiz competitions
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Your quizzes</h1>
        </div>
        <Button
          onClick={() => router.push("/quiz/create")}
          className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-5"
        >
          <Plus className="size-4 mr-1.5" /> New quiz
        </Button>
      </motion.div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary/60" />
        </div>
      ) : quizzes.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="text-center py-24 space-y-4"
        >
          <div className="size-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Trophy className="size-6 text-primary/70" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold">No quizzes yet</h2>
            <p className="text-sm text-muted-foreground/60 max-w-sm mx-auto">
              Build a Mentimeter-style quiz competition — timed questions, live answers, and a
              running leaderboard.
            </p>
          </div>
          <Button
            onClick={() => router.push("/quiz/create")}
            className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6"
          >
            Create your first quiz
          </Button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quizzes.map((quiz, i) => {
            const chip = statusChip[quiz.status];
            return (
              <motion.div
                key={quiz._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease, delay: i * 0.05 }}
                className="p-1.5 rounded-[2rem] bg-white/5 border border-white/10"
              >
                <div className="rounded-[calc(2rem-0.375rem)] bg-card p-5 space-y-4 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-bold tracking-tight text-foreground/90 leading-snug">
                      {quiz.title}
                    </h2>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${chip.className}`}
                    >
                      {chip.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
                    <span className="flex items-center gap-1.5">
                      <Layers className="size-3.5" /> {quiz.slides.length} slide
                      {quiz.slides.length !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(quiz.joinCode);
                        toast.success("Join code copied!");
                      }}
                      className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                      title="Copy join code"
                    >
                      <Copy className="size-3" />
                      <span className="font-mono font-bold tracking-widest">{quiz.joinCode}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 pt-1 mt-auto">
                    <Button
                      onClick={() => router.push(`/quiz/host/${quiz._id}`)}
                      className="h-9 rounded-full bg-primary text-primary-foreground font-semibold px-4 text-xs"
                    >
                      <Play className="size-3.5 mr-1.5" /> Host live
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => router.push(`/quiz/create?id=${quiz._id}`)}
                      className="h-9 rounded-full px-4 text-xs font-semibold border-white/15"
                    >
                      <Pencil className="size-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void handleDelete(quiz)}
                      className="h-9 rounded-full px-3 text-xs text-muted-foreground/60 hover:text-red-400 ml-auto"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
