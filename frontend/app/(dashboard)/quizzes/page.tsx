"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Plus, Trophy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteQuiz, listQuizzes } from "@/features/quizzes/api/quizApi";
import { QuizCard } from "@/features/quizzes/components/QuizCard";
import { useCreateQuizModal } from "@/features/quizzes/components/CreateQuizModalProvider";
import type { Quiz } from "@/features/quizzes/types";

const ease = [0.32, 0.72, 0, 1] as const;

export default function QuizzesPage() {
  const { open: openCreateQuizModal } = useCreateQuizModal();
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
          onClick={() => openCreateQuizModal()}
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
              Build a Mentimeter-style quiz — scored questions, word clouds, rankings, and a
              running leaderboard.
            </p>
          </div>
          <Button
            onClick={() => openCreateQuizModal()}
            className="h-11 rounded-full bg-primary text-primary-foreground font-semibold px-6"
          >
            Create your first quiz
          </Button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quizzes.map((quiz, i) => (
            <QuizCard key={quiz._id} quiz={quiz} index={i} onDelete={(q) => void handleDelete(q)} />
          ))}
        </div>
      )}
    </div>
  );
}
