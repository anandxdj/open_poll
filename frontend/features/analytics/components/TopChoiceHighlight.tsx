"use client";

import { Trophy, Zap } from "lucide-react";
import type { Poll } from "@/features/polls/store/useCreatorStore";
import type { PollAnalyticsPayload } from "../types";

interface TopChoiceHighlightProps {
  poll: Poll;
  analytics: PollAnalyticsPayload;
}

export function TopChoiceHighlight({ poll, analytics }: TopChoiceHighlightProps) {
  if (analytics.totalResponses === 0) return null;

  // Find the overall most voted option across all questions
  let topAnswer = { text: "", votes: -1, questionTitle: "" };

  poll.questions.forEach((q) => {
    const summary = analytics.questionSummaries.find((s) => s.questionId === String(q._id));
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

  const percentage = ((topAnswer.votes / analytics.totalResponses) * 100).toFixed(0);

  return (
    <div className="bezel-outer">
      <div className="bezel-inner relative overflow-hidden bg-gradient-to-br from-primary/10 via-transparent to-transparent p-6">
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/20 ring-1 ring-primary/30">
            <Trophy className="size-6 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                Poll Insight
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                <Zap className="size-2.5" />
                Trending
              </span>
            </div>
            <h3 className="text-sm font-medium text-white/90">
              "<span className="text-primary">{topAnswer.text}</span>" is currently the leading answer
              for <span className="italic text-white/50">{topAnswer.questionTitle}</span>.
            </h3>
            <p className="text-xs text-white/30">
              Captured {topAnswer.votes} out of {analytics.totalResponses} total responses ({percentage}%).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
