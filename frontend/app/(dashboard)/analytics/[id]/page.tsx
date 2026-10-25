"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp, Copy, Globe, Search, Send } from "lucide-react";
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
import { SettingsLoading } from "@/features/workspaces/settings/blocks";

const VOTER_FILTERS = [
  { id: "all", label: "Everyone" },
  { id: "registered", label: "Registered" },
  { id: "guest", label: "Guests" },
  { id: "anonymous", label: "Anonymous" },
] as const;

const VOTER_TYPE_LABEL = { registered: "Registered", guest: "Guest", anonymous: "Anonymous" } as const;

const page = "mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8";

type ApiOk<T> = { success: boolean; message: string; data: T };

export default function AnalyticsPollPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : undefined;

  const [poll, setPoll] = useState<Poll | null>(null);
  const [analytics, setAnalytics] = useState<PollAnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [visType, setVisType] = useState<VisualizationType>("bar-h");
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
    return <p className={cn(page, "text-sm text-muted-foreground")}>Missing poll id.</p>;
  }

  if (loading) {
    return (
      <div className={page}>
        <SettingsLoading>Loading analytics…</SettingsLoading>
      </div>
    );
  }

  if (error || !poll) {
    return (
      <div className={page}>
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            {error ?? "Poll not found."}{" "}
            <Link href="/analytics" className="font-medium underline underline-offset-4">
              Back to analytics
            </Link>
          </p>
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

  const tabClass = (active: boolean) =>
    cn(
      "flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className={page}>
      <Link
        href="/analytics"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Analytics
      </Link>

      <header className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">{poll.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            Counts update live as responses arrive.
            {poll.isResultsPublished ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground">
                <Globe className="size-3.5 text-success" aria-hidden="true" />
                Results are public
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 md:shrink-0">
          {!poll.isResultsPublished ? (
            <>
              <Button variant="outline" className="bg-card" onClick={handleShare}>
                <Copy /> Copy poll link
              </Button>
              <Button onClick={handlePublish} disabled={publishing}>
                <Globe /> {publishing ? "Publishing…" : "Publish results"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="bg-card" onClick={handleShareX}>
                <Send /> Share on X
              </Button>
              <Button variant="ink" onClick={handleShare}>
                <Copy /> Copy poll link
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="mt-8">
        <AnalyticsHeaderStats poll={poll} totalResponses={total} />
      </div>

      <div className="mt-8 flex flex-col gap-3 border-b border-border sm:flex-row sm:items-end sm:justify-between">
        <div role="tablist" aria-label="Poll analytics" className="-mb-px flex gap-6">
          <button type="button" role="tab" aria-selected={activeTab === "summary"} onClick={() => setActiveTab("summary")} className={tabClass(activeTab === "summary")}>
            Results
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "voters"} onClick={openVotersTab} className={tabClass(activeTab === "voters")}>
            Voters
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{total}</span>
          </button>
        </div>
        {activeTab === "summary" ? (
          <div className="pb-3">
            <VisualizationPicker value={visType} onChange={setVisType} />
          </div>
        ) : null}
      </div>

      {activeTab === "summary" ? (
        <div className="mt-6 space-y-4">
          {analytics ? <TopChoiceHighlight poll={poll} analytics={analytics} /> : null}

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
            // Assessments show which answers are right.
            const trial = poll.pollType === "TRIAL";

            return (
              <QuestionAnalytics
                key={qid || q.text}
                title={q.text}
                data={data}
                type={visType}
                correctOptionIndices={trial ? q.correctOptionIndices : undefined}
                explanation={trial ? q.explanation : undefined}
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search by name or email"
                aria-label="Search voters by name or email"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              />
            </div>
            <div role="group" aria-label="Voter type" className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
              {VOTER_FILTERS.map((f) => {
                const active = filterType === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setFilterType(f.id);
                      setExpandedRow(null);
                    }}
                    className={cn(
                      "h-8 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
                      active ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {votersLoading ? (
            <div className="rounded-xl border border-border bg-card p-8">
              <SettingsLoading>Loading voters…</SettingsLoading>
            </div>
          ) : votersError ? (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{votersError}</p>
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
                  <div className="rounded-xl border border-border bg-card p-10 text-center">
                    <p className="text-base font-semibold text-foreground">No voters found</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {searchQuery || filterType !== "all"
                        ? "Try another search or voter type."
                        : "No one has answered this poll yet."}
                    </p>
                  </div>
                );
              }

              return (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                          <th className="px-5 py-3 font-medium">Voter</th>
                          <th className="px-5 py-3 font-medium">Type</th>
                          <th className="px-5 py-3 font-medium">Submitted</th>
                          <th className="px-5 py-3 text-right font-medium">
                            <span className="sr-only">Answers</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filtered.map((item) => {
                          const isExpanded = expandedRow === item._id;
                          const hasAnswers = item.answers && item.answers.length > 0;
                          const dateFormatted = (() => {
                            try {
                              return new Date(item.createdAt).toLocaleString(undefined, {
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
                            <tr key={item._id} className={cn("align-top transition-colors", isExpanded ? "bg-accent/40" : "hover:bg-accent/30")}>
                              <td className="px-5 py-3.5">
                                <p className="font-medium text-foreground">{item.voter.name}</p>
                                {item.voter.email ? <p className="text-xs text-muted-foreground">{item.voter.email}</p> : null}
                              </td>
                              <td className="px-5 py-3.5">
                                <span className="inline-flex rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                  {VOTER_TYPE_LABEL[item.voter.type]}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-5 py-3.5 text-muted-foreground">{dateFormatted}</td>
                              <td className="px-5 py-3.5 text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!hasAnswers}
                                  aria-expanded={isExpanded}
                                  onClick={() => setExpandedRow(isExpanded ? null : item._id)}
                                >
                                  {isExpanded ? "Hide answers" : "View answers"}
                                  {isExpanded ? <ChevronUp /> : <ChevronDown />}
                                </Button>
                                {isExpanded ? (
                                  <dl className="mt-3 space-y-2.5 rounded-lg border border-border bg-background p-3.5 text-left">
                                    {item.answers.map((ans, aIdx) => (
                                      <div key={ans.questionId || aIdx}>
                                        <dt className="text-xs text-muted-foreground">{ans.questionText}</dt>
                                        <dd className="text-sm font-medium text-foreground">{ans.selectedOptionText}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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
