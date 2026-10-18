"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, 
  Users, 
  Search, 
  Mail, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  BarChart3, 
  AlertCircle,
  CheckCircle2, 
  Share2, 
  Send 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnalyticsHeaderStats } from "@/features/analytics/components/AnalyticsHeaderStats";
import { TopChoiceHighlight } from "@/features/analytics/components/TopChoiceHighlight";
import { QuestionAnalytics } from "@/features/analytics/components/QuestionAnalytics";
import { VisualizationPicker, type VisualizationType } from "@/features/analytics/components/VisualizationPicker";
import { useSocketListener } from "@/features/analytics/hooks/useSocketListener";
import {
  emptyPollAnalytics,
  type PollAnalyticsPayload,
  type PollVoterRecord,
} from "@/features/analytics/types";
import type { Poll } from "@/features/polls/store/useCreatorStore";
import { apiClient } from "@/lib/api-client";
import { useCreatorStore } from "@/features/polls/store/useCreatorStore";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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

  const [voters, setVoters] = useState<PollVoterRecord[]>([]);
  const [votersLoading, setVotersLoading] = useState(false);
  const [votersError, setVotersError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "voters">("summary");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "registered" | "guest" | "anonymous">("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchVoterList = useCallback(async () => {
    if (!id) return;
    setVotersLoading(true);
    setVotersError(null);
    try {
      const res = await apiClient.get<ApiOk<PollVoterRecord[]>>(`/responses/poll/${id}/list`);
      setVoters(res.data.data);
    } catch {
      setVotersError("Failed to load voter activity list.");
    } finally {
      setVotersLoading(false);
    }
  }, [id]);

  // Refetch the voter log each time the user switches to its tab.
  const openVotersTab = () => {
    if (activeTab === "voters") return;
    setActiveTab("voters");
    void fetchVoterList();
  };

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
        console.log("[Analytics] Poll Response:", pollRes.data);
        if (cancelled) return;
        setPoll(pollRes.data.data);

        let summary: PollAnalyticsPayload;
        try {
          const summaryRes = await apiClient.get<ApiOk<PollAnalyticsPayload>>(`/responses/poll/${id}/summary`);
          console.log("[Analytics] Summary Response:", summaryRes.data);
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
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
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

        <div className="flex flex-col items-end gap-4 md:flex-shrink-0">
          <div className="flex flex-wrap items-center justify-end gap-3">
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
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">
              Visualization
            </span>
            <VisualizationPicker value={visType} onChange={setVisType} />
          </div>
        </div>
      </div>

      {/* Aggregate Stats */}
      <AnalyticsHeaderStats poll={poll} totalResponses={total} />

      {/* Tab Switcher */}
      <div className="flex border-b border-white/[0.06] gap-6 pb-px mt-4">
        <button
          onClick={() => setActiveTab("summary")}
          className={cn(
            "pb-4 text-xs font-bold uppercase tracking-widest transition-all relative flex items-center gap-1.5 outline-none select-none",
            activeTab === "summary"
              ? "text-primary border-b-2 border-primary"
              : "text-white/45 hover:text-white/70"
          )}
        >
          <BarChart3 className="size-3.5" />
          <span>Overview Charts</span>
        </button>
        <button
          onClick={openVotersTab}
          className={cn(
            "pb-4 text-xs font-bold uppercase tracking-widest transition-all relative flex items-center gap-1.5 outline-none select-none",
            activeTab === "voters"
              ? "text-primary border-b-2 border-primary"
              : "text-white/45 hover:text-white/70"
          )}
        >
          <Users className="size-3.5" />
          <span>Voter Activity Log</span>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-extrabold text-primary border border-primary/20">
            {total}
          </span>
        </button>
      </div>

      {activeTab === "summary" ? (
        <>
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

            {poll.questions.map((q, index) => {
              const qid = String(q._id ?? "");
              // Try finding by ID first, fallback to index for corrupted old polls
              let summary = analytics?.questionSummaries.find((s) => s.questionId === qid);
              if (!summary && analytics?.questionSummaries[index]) {
                summary = analytics.questionSummaries[index];
              }
              
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
        </>
      ) : (
        /* Voter Activity Log Tab */
        <div className="space-y-6">
          {/* Controls Bar: Search & Filter */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md group">
              <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-white/30 group-focus-within:text-primary transition-colors">
                <Search className="size-4" />
              </div>
              <input
                type="text"
                placeholder="Search voters by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#14120f]/50 border border-white/[0.08] focus:border-primary/50 focus:ring-primary/20 h-10 pl-10 pr-4 rounded-xl text-white text-xs placeholder:text-white/20 transition-all outline-none"
              />
            </div>

            {/* Type Filters */}
            <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider">
              {(["all", "registered", "guest", "anonymous"] as const).map((type) => {
                const isActive = filterType === type;
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setFilterType(type);
                      setExpandedRow(null);
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg border transition-all select-none outline-none",
                      isActive
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-white/[0.06] bg-transparent text-white/40 hover:text-white/60"
                    )}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Loader / Error / Empty States */}
          {votersLoading ? (
            <div className="rounded-2xl border border-white/[0.06] bg-[#0d0d0d]/80 p-12 flex flex-col items-center justify-center gap-3">
              <div className="size-8 rounded-xl bg-primary/20 flex items-center justify-center animate-pulse border border-primary/30">
                <Users className="size-4 text-primary animate-spin" />
              </div>
              <p className="text-xs text-white/40 font-medium">Loading voter logs...</p>
            </div>
          ) : votersError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-6 flex items-center gap-3 text-red-300">
              <AlertCircle className="size-5 shrink-0" />
              <div className="text-xs">
                <p className="font-semibold">Error loading voter list</p>
                <p className="text-red-300/60 mt-0.5">{votersError}</p>
              </div>
            </div>
          ) : (
            (() => {
              const filtered = voters.filter((v) => {
                const name = v.voter.name || "";
                const email = v.voter.email || "";
                const matchesSearch =
                  name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  email.toLowerCase().includes(searchQuery.toLowerCase());
                const matchesType = filterType === "all" || v.voter.type === filterType;
                return matchesSearch && matchesType;
              });

              if (filtered.length === 0) {
                return (
                  <div className="rounded-2xl border border-white/[0.06] bg-[#0d0d0d]/80 p-12 text-center space-y-2">
                    <p className="text-sm font-semibold text-white/80">No voter records found</p>
                    <p className="text-xs text-white/40">
                      {searchQuery || filterType !== "all"
                        ? "Try adjusting your search query or filter options."
                        : "No responses have been submitted to this poll yet."}
                    </p>
                  </div>
                );
              }

              return (
                <div className="relative group w-full">
                  <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-white/[0.08] to-transparent opacity-40 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="absolute inset-[1px] rounded-[23px] bg-[#0d0d0d]/80 backdrop-blur-2xl" />

                  <div className="relative overflow-hidden rounded-[23px] border border-white/[0.06]">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/[0.06] text-[10px] font-bold uppercase tracking-widest text-white/30 bg-white/[0.02]">
                            <th className="py-4 px-5">Voter</th>
                            <th className="py-4 px-5">Type</th>
                            <th className="py-4 px-5">Submitted</th>
                            <th className="py-4 px-5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {filtered.map((item) => {
                            const isExpanded = expandedRow === item._id;
                            const hasAnswers = item.answers && item.answers.length > 0;
                            const dateFormatted = (() => {
                              try {
                                return new Date(item.createdAt).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                });
                              } catch {
                                return "Just now";
                              }
                            })();

                            return (
                              <tr
                                key={item._id}
                                className={cn(
                                  "text-xs transition-colors duration-200 align-top",
                                  isExpanded ? "bg-white/[0.02]" : "hover:bg-white/[0.01]"
                                )}
                              >
                                <td className="py-4 px-5">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-bold text-white/80">
                                      {item.voter.name}
                                    </span>
                                    {item.voter.email && (
                                      <span className="text-[10px] font-medium text-white/30 flex items-center gap-1">
                                        <Mail className="size-3 text-white/20" />
                                        {item.voter.email}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-4 px-5">
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                                      item.voter.type === "registered"
                                        ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                                        : item.voter.type === "guest"
                                        ? "bg-amber-500/10 text-primary border border-amber-500/20"
                                        : "bg-white/5 text-white/40 border border-white/10"
                                    )}
                                  >
                                    {item.voter.type}
                                  </span>
                                </td>

                                <td className="py-4 px-5 text-white/40 font-medium">
                                  <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                                    <Clock className="size-3 text-white/20" />
                                    {dateFormatted}
                                  </div>
                                </td>

                                <td className="py-4 px-5 text-right">
                                  <div className="flex flex-col items-end">
                                    <button
                                      disabled={!hasAnswers}
                                      onClick={() =>
                                        setExpandedRow(isExpanded ? null : item._id)
                                      }
                                      className={cn(
                                        "h-8 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 border transition-all outline-none",
                                        !hasAnswers
                                          ? "opacity-30 cursor-not-allowed"
                                          : isExpanded
                                          ? "border-primary bg-primary/10 text-primary"
                                          : "border-white/10 text-white/60 hover:border-white/25 hover:text-white"
                                      )}
                                    >
                                      <span>{isExpanded ? "Hide Details" : "View Answers"}</span>
                                      {isExpanded ? (
                                        <ChevronUp className="size-3" />
                                      ) : (
                                        <ChevronDown className="size-3" />
                                      )}
                                    </button>

                                    {isExpanded && (
                                      <div className="w-full text-left bg-black/40 border border-white/[0.04] rounded-xl p-3.5 mt-3 space-y-3 shadow-inner">
                                        <h4 className="text-[9px] font-bold uppercase tracking-widest text-primary/70 flex items-center gap-1.5 select-none">
                                          <Users className="size-3" /> Answers Breakdown
                                        </h4>
                                        <div className="grid gap-2.5 max-w-lg">
                                          {item.answers.map((ans, aIdx) => (
                                            <div
                                              key={ans.questionId || aIdx}
                                              className="flex flex-col gap-0.5 border-l border-white/10 pl-3 py-0.5"
                                            >
                                              <span className="text-[10px] font-semibold text-white/40 leading-snug">
                                                {ans.questionText}
                                              </span>
                                              <span className="text-xs font-bold text-primary leading-snug">
                                                {ans.selectedOptionText}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
