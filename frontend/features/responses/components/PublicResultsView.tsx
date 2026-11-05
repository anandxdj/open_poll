"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, Link as LinkIcon, Send } from "lucide-react";
import { toast } from "sonner";
import type { Poll } from "@/features/polls/store/useCreatorStore";
import { QuestionAnalytics } from "@/features/analytics/components/QuestionAnalytics";
import { VisualizationPicker, type VisualizationType } from "@/features/analytics/components/VisualizationPicker";
import { apiClient } from "@/lib/api-client";
import { emptyPollAnalytics, type PollAnalyticsPayload } from "@/features/analytics/types";
import { PublicPageShell } from "@/features/landing/components/shared/PublicPageShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  poll: Poll;
  /** Shown above the title, e.g. that this visitor has already answered. */
  notice?: ReactNode;
};

type ApiOk<T> = { success: boolean; message: string; data: T };

export function PublicResultsView({ poll, notice }: Props) {
  const [analytics, setAnalytics] = useState<PollAnalyticsPayload | null>(null);
  const [visType, setVisType] = useState<VisualizationType>("bar-v");
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

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

  const handleShare = async () => {
    const url = `${window.location.origin}/p/${poll._id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      toast.success("Poll link copied.");
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  const handleShareX = () => {
    const url = encodeURIComponent(`${window.location.origin}/p/${poll._id}`);
    const text = encodeURIComponent(`Results for "${poll.title}" on Open Poll`);
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, "_blank");
  };

  const handleExportCSV = () => {
    if (!analytics) {
      toast.error("No analytics data available to export.");
      return;
    }
    
    // Header Row
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Question Number,Question Text,Option Number,Option Label,Vote Count,Percentage\n";
    
    poll.questions.forEach((q, idx) => {
      const qid = String(q._id ?? "");
      const summary = analytics.questionSummaries.find((s) => s.questionId === qid);
      const counts = summary?.counts ?? q.options.map(() => 0);
      const total = counts.reduce((a, b) => a + b, 0) || 1;
      
      q.options.forEach((opt, optIdx) => {
        const votes = counts[optIdx] ?? 0;
        const pct = ((votes / total) * 100).toFixed(1);
        const escapedQuestion = q.text.replace(/"/g, '""');
        const escapedOption = opt.replace(/"/g, '""');
        
        const row = [
          idx + 1,
          `"${escapedQuestion}"`,
          optIdx + 1,
          `"${escapedOption}"`,
          votes,
          `${pct}%`
        ].join(",");
        csvContent += row + "\n";
      });
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `poll_results_${poll._id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("CSV downloaded.");
  };

  const isQuiz = poll.pollType === "TRIAL";
  const label = isQuiz ? "Quiz results" : "Poll results";

  if (loading) {
    return (
      <PublicPageShell label={label} width="wide">
        <div role="status" aria-label="Loading results" className="space-y-6">
          <div className="h-12 w-2/3 animate-pulse rounded-lg bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-80 animate-pulse rounded-xl bg-muted" />
        </div>
      </PublicPageShell>
    );
  }

  const stats = [
    { label: "Responses", value: analytics?.totalResponses ?? 0 },
    { label: "Questions", value: poll.questions.length },
  ];

  return (
    <PublicPageShell label={label} width="wide" footer={{ note: "Made with Open Poll", cta: "Make your own poll" }}>
      {notice ? <div className="mb-8">{notice}</div> : null}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <h1 className="text-balance text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">{poll.title}</h1>
        <div className="flex flex-wrap gap-2 md:shrink-0">
          <Button variant="outline" className="bg-card" onClick={handleShare}>
            {copiedLink ? <Check /> : <LinkIcon />} {copiedLink ? "Copied" : "Copy link"}
          </Button>
          <Button variant="outline" className="bg-card" onClick={handleExportCSV}>
            <Download /> Export CSV
          </Button>
          <Button variant="outline" className="bg-card" onClick={handleShareX}>
            <Send /> Share on X
          </Button>
        </div>
      </header>

      <dl className="mt-8 grid grid-cols-2 border-y border-border">
        {stats.map((stat, i) => (
          <div key={stat.label} className={cn("py-4 sm:py-5", i > 0 && "border-l border-border pl-4 sm:pl-6")}>
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1.5 text-3xl font-semibold leading-none tabular-nums tracking-[-0.03em] sm:text-4xl">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">Results by question</h2>
        <VisualizationPicker value={visType} onChange={setVisType} />
      </div>

      <div className="mt-6 space-y-6">
        {poll.questions.map((q) => {
          const qid = String(q._id ?? "");
          const summary = analytics?.questionSummaries.find((s) => s.questionId === qid);
          const counts = summary?.counts ?? q.options.map(() => 0);
          const data = q.options.map((optionLabel, i) => ({
            label: optionLabel,
            votes: counts[i] ?? 0,
          }));

          return (
            <QuestionAnalytics
              key={qid || q.text}
              title={q.text}
              data={data}
              type={visType}
              correctOptionIndices={isQuiz ? q.correctOptionIndices : undefined}
              explanation={isQuiz ? q.explanation : undefined}
            />
          );
        })}
      </div>
    </PublicPageShell>
  );
}
