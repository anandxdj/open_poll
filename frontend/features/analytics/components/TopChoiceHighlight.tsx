"use client";

import { Trophy } from "lucide-react";
import type { Poll } from "@/features/polls/store/useCreatorStore";
import type { PollAnalyticsPayload } from "../types";

interface TopChoiceHighlightProps {
  poll: Poll;
  analytics: PollAnalyticsPayload;
}

/** One sentence on the most chosen answer across the poll; nothing until someone has answered. */
export function TopChoiceHighlight({ poll, analytics }: TopChoiceHighlightProps) {
  if (analytics.totalResponses === 0) return null;

  // Find the overall most voted option across all questions
  let topAnswer = { text: "", votes: -1, questionTitle: "" };

  poll.questions.forEach((q, index) => {
    let summary = analytics.questionSummaries.find((s) => s.questionId === String(q._id));
    // Fallback to index-based match if ID mismatch (repair corrupted old polls)
    if (!summary && analytics.questionSummaries[index]) {
      summary = analytics.questionSummaries[index];
    }

    if (summary) {
      summary.counts.forEach((count, i) => {
        if (count > topAnswer.votes) {
          topAnswer = {
            text: q.options[i],
            votes: count,
            questionTitle: q.text,
          };
        }
      });
    }
  });

  if (topAnswer.votes <= 0) return null;

  const percentage = Math.round((topAnswer.votes / analytics.totalResponses) * 100);

  return (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-5 sm:p-6">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-accent-ink">
        <Trophy className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">Leading answer</p>
        <p className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-foreground">{topAnswer.text}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono tabular-nums text-foreground">{topAnswer.votes}</span> of{" "}
          <span className="font-mono tabular-nums text-foreground">{analytics.totalResponses}</span> responses (
          {percentage}%) on &ldquo;{topAnswer.questionTitle}&rdquo;
        </p>
      </div>
    </div>
  );
}
