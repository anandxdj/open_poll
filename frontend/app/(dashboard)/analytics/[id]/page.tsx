"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";

import { AnalyticsHeaderStats } from "@/features/analytics/components/AnalyticsHeaderStats";
import { TopChoiceHighlight } from "@/features/analytics/components/TopChoiceHighlight";
import { QuestionAnalytics } from "@/features/analytics/components/QuestionAnalytics";
import { VisualizationPicker, type VisualizationType } from "@/features/analytics/components/VisualizationPicker";
import { useSocketListener } from "@/features/analytics/hooks/useSocketListener";
import { emptyPollAnalytics, type PollAnalyticsPayload } from "@/features/analytics/types";
import type { Poll } from "@/features/polls/store/useCreatorStore";
import { apiClient } from "@/lib/api-client";
import { useCreatorStore } from "@/features/polls/store/useCreatorStore";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Share2, Send } from "lucide-react";

type ApiOk<T> = { success: boolean; message: string; data: T };

export default function AnalyticsPollPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : undefined;

  const [poll, setPoll] = useState<Poll | null>(null);
  const [analytics, setAnalytics] = useState<PollAnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [visType, setVisType] = useState<VisualizationType>("bar-v");
  const [publishing, setPublishing] = useState(false);

  const publishResults = useCreatorStore((state) => state.publishResults);

  const onSocketUpdate = useCallback((payload: PollAnalyticsPayload) => {
    setAnalytics(payload);
  }, []);

  useSocketListener({ pollId: id, enabled: Boolean(id && poll), onUpdate: onSocketUpdate });

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const pollRes = await apiClient.get<ApiOk<Poll>>(`/polls/${id}`);
        if (cancelled) return;
        setPoll(pollRes.data.data);

        let summary: PollAnalyticsPayload;
        try {
          const summaryRes = await apiClient.get<ApiOk<PollAnalyticsPayload>>(`/responses/poll/${id}/summary`);
          summary = summaryRes.data.data;
        } catch {
          summary = emptyPollAnalytics(id);
        }
        if (cancelled) return;
        setAnalytics(summary);
      } catch {
        if (cancelled) return;
        setError("We could not load this poll.");
        setPoll(null);
        setAnalytics(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) {
    return <p className="text-sm text-white/40">Missing poll id.</p>;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <div className="rounded-2xl border border-white/[0.06] bg-[#0d0d0d]/80 p-6 text-sm text-white/40">
          Loading analytics…
        </div>
      </div>
    );
  }

  if (error || !poll) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-6 text-sm text-red-300">
          {error ?? "Poll not found."}{" "}
          <Link
            href="/analytics"
            className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
          >
            Back to analytics
          </Link>
        </div>
      </div>
    );
  }

  const total = analytics?.totalResponses ?? 0;

  const handlePublish = async () => {
    if (!id) return;
    setPublishing(true);
    try {
      await publishResults(id);
      const pollRes = await apiClient.get<ApiOk<Poll>>(`/polls/${id}`);
      setPoll(pollRes.data.data);
      toast.success("Results are now public!");
    } catch {
      toast.error("Failed to publish results.");
    } finally {
      setPublishing(false);
    }
  };

  const handleShare = () => {
    const url = `${window.location.origin}/p/${id}`;
    navigator.clipboard.writeText(url);
    toast.success("Poll link copied to clipboard!");
  };

  const handleShareX = () => {
    if (!id) return;
    const url = encodeURIComponent(`${window.location.origin}/p/${id}`);
    const text = encodeURIComponent(`Check out the live results for "${poll?.title}" on Open Poll!`);
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, "_blank");
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 md:px-6">
      {/* Header section */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="-ml-2 h-8 gap-2 rounded-xl text-white/40 hover:bg-primary/10 hover:text-primary group/back"
          >
            <Link href="/analytics">
              <ArrowLeft className="size-3.5 transition-transform group-hover/back:-translate-x-0.5" />
              Analytics
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white/90 md:text-3xl">
              {poll.title}
            </h1>
            {poll.isResultsPublished && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                <CheckCircle2 className="size-3" />
                Results Public
              </span>
            )}
          </div>
          <p className="text-sm text-white/35">Live counts update as responses arrive.</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {!poll.isResultsPublished ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-xl border-primary/20 bg-primary/10 text-[11px] font-bold uppercase tracking-widest text-primary hover:bg-primary/20"
              onClick={handlePublish}
              disabled={publishing}
            >
              <Share2 className="mr-2 size-3.5" />
              {publishing ? "Publishing..." : "Publish Results"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-xl border-emerald-500/20 bg-emerald-500/10 text-[11px] font-bold uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/20"
              onClick={handleShare}
            >
              <Share2 className="mr-2 size-3.5" />
              Copy Link
            </Button>
          )}
          {poll.isResultsPublished && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-xl border-sky-500/20 bg-sky-500/10 text-[11px] font-bold uppercase tracking-widest text-sky-400 hover:bg-sky-500/20"
              onClick={handleShareX}
            >
              <Send className="mr-2 size-3.5 fill-sky-400" />
              Share on X
            </Button>
          )}
          {!poll.isResultsPublished && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-xl text-[11px] font-bold uppercase tracking-widest text-white/40 hover:text-white/60"
              onClick={handleShare}
            >
              <Share2 className="mr-2 size-3.5" />
              Share Poll
            </Button>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">
              Visualization
            </span>
            <VisualizationPicker value={visType} onChange={setVisType} />
          </div>
        </div>
      </div>

      {/* Aggregate Stats */}
      <AnalyticsHeaderStats poll={poll} totalResponses={total} />

      {/* Insight Highlight */}
      {analytics && <TopChoiceHighlight poll={poll} analytics={analytics} />}

      {/* Questions List */}
      <div className="grid gap-6">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">
            Question Breakdown
          </span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>

        {poll.questions.map((q) => {
          const qid = String(q._id ?? "");
          const summary = analytics?.questionSummaries.find((s) => s.questionId === qid);
          const counts = summary?.counts ?? q.options.map(() => 0);
          const data = q.options.map((label, i) => ({
            label,
            votes: counts[i] ?? 0,
          }));

          return (
            <QuestionAnalytics key={qid || q.text} title={q.text} data={data} type={visType} />
          );
        })}
      </div>
    </div>
  );
}
