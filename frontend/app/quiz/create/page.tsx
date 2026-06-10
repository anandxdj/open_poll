"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { QuizBuilder } from "@/features/quizzes/components/QuizBuilder";

export default function QuizCreatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary/60" />
        </div>
      }
    >
      <QuizBuilder />
    </Suspense>
  );
}
