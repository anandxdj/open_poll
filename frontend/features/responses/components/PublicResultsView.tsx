"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Zap, Trophy, BarChart3, Share2, Send } from "lucide-react";
import { toast } from "sonner";
import type { Poll } from "@/features/polls/store/useCreatorStore";
import { QuestionAnalytics } from "@/features/analytics/components/QuestionAnalytics";
import { VisualizationPicker, type VisualizationType } from "@/features/analytics/components/VisualizationPicker";
import { apiClient } from "@/lib/api-client";
import { emptyPollAnalytics, type PollAnalyticsPayload } from "@/features/analytics/types";

type Props = {
  poll: Poll;
};

type ApiOk<T> = { success: boolean; message: string; data: T };

const ease = [0.32, 0.72, 0, 1] as const;

export function PublicResultsView({ poll }: Props) {
  const [analytics, setAnalytics] = useState<PollAnalyticsPayload | null>(null);
  const [visType, setVisType] = useState<VisualizationType>("bar-v");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await apiClient.get<ApiOk<PollAnalyticsPayload>>(`/responses/poll/${poll._id}/summary`);
        if (!cancelled) setAnalytics(res.data.data);
      } catch {
        if (!cancelled) setAnalytics(emptyPollAnalytics(poll._id));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [poll._id]);

  const handleShare = () => {
    const url = `${window.location.origin}/p/${poll._id}`;
    navigator.clipboard.writeText(url);
    toast.success("Result link copied to clipboard!");
  };

  const handleShareX = () => {
    const url = encodeURIComponent(`${window.location.origin}/p/${poll._id}`);
    const text = encodeURIComponent(`Check out the results for "${poll.title}" on Open Poll!`);
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, "_blank");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <div className="size-10 rounded-xl bg-primary/20 flex items-center justify-center animate-pulse border border-primary/30">
          <Zap className="size-5 text-primary fill-primary" />
        </div>
        <p className="mt-4 text-xs font-bold uppercase tracking-widest text-white/20 animate-pulse">
          Fetching results…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-white/90 selection:bg-primary selection:text-primary-foreground">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/[0.03] blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-white/[0.06] bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="size-4 text-primary-foreground fill-primary-foreground" />
          </div>
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
            Open Poll
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:bg-white/[0.06] hover:text-white/60 transition-all"
          >
            <Share2 className="size-3" />
            Link
          </button>
          <button
            onClick={handleShareX}
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-sky-400 hover:bg-sky-500/20 transition-all"
          >
            <Send className="size-3 fill-sky-400" />
            Share
          </button>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
            <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            Final Results
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-6 py-12 space-y-12">
        {/* Title & Stats */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
              <Trophy className="size-3" />
              Poll Conclusion
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white/90 md:text-4xl">
              {poll.title}
            </h1>
            <div className="flex items-center gap-4 pt-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">Total Responses</span>
                <span className="text-sm font-bold text-white/70 tabular-nums">{analytics?.totalResponses ?? 0}</span>
              </div>
              <div className="h-3 w-px bg-white/[0.1]" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">Questions</span>
                <span className="text-sm font-bold text-white/70 tabular-nums">{poll.questions.length}</span>
              </div>
            </div>
          </motion.div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">
              Change View
            </span>
            <VisualizationPicker value={visType} onChange={setVisType} />
          </div>
        </div>

        {/* Results Sections */}
        <div className="space-y-8">
          {poll.questions.map((q, idx) => {
            const qid = String(q._id ?? "");
            const summary = analytics?.questionSummaries.find((s) => s.questionId === qid);
            const counts = summary?.counts ?? q.options.map(() => 0);
            const data = q.options.map((label, i) => ({
              label,
              votes: counts[i] ?? 0,
            }));

            return (
              <motion.div
                key={qid || q.text}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex size-6 items-center justify-center rounded-lg bg-white/[0.05] text-[10px] font-bold text-white/40">
                    {idx + 1}
                  </div>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
                <QuestionAnalytics 
                  title={q.text} 
                  data={data} 
                  type={visType} 
                />
              </motion.div>
            );
          })}
        </div>

        {/* Closing */}
        <footer className="pt-12 text-center">
          <div className="inline-flex flex-col items-center gap-4">
            <div className="h-px w-12 bg-white/[0.1]" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/10">
              Verified by Open Poll Protocol
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
