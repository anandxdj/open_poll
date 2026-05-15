"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { ProductLogo } from "@/components/ui/ProductLogo";

import { PollCardV2 } from "@/features/polls/components/PollCardV2";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";
import { useCreatorStore, type Poll } from "@/features/polls/store/useCreatorStore";
import { cn } from "@/lib/utils";

type Tab = "all" | "active" | "draft" | "expired";

function isPollActive(poll: Poll) {
  if (!poll.isPublished || poll.isClosed) return false;
  return new Date(poll.expiresAt).getTime() > Date.now();
}

export default function PollsPage() {
  const { polls, isLoading, error, fetchPolls } = useCreatorStore();
  const { open: openCreatePollModal } = useCreatePollModal();
  const [activeTab, setActiveTab] = useState<Tab>("all");

  useEffect(() => {
    void fetchPolls();
  }, [fetchPolls]);

  const activeCount = useMemo(() => polls.filter(isPollActive).length, [polls]);
  const draftCount = useMemo(() => polls.filter((p) => !p.isPublished).length, [polls]);
  const expiredCount = useMemo(
    () => polls.filter((p) => p.isPublished && !isPollActive(p)).length,
    [polls]
  );

  const filteredPolls = useMemo(() => {
    switch (activeTab) {
      case "active":
        return polls.filter(isPollActive);
      case "draft":
        return polls.filter((p) => !p.isPublished);
      case "expired":
        return polls.filter((p) => p.isPublished && !isPollActive(p));
      default:
        return polls;
    }
  }, [polls, activeTab]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: polls.length },
    { key: "active", label: "Active", count: activeCount },
    { key: "draft", label: "Drafts", count: draftCount },
    { key: "expired", label: "Expired", count: expiredCount },
  ];

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-xl md:px-6 sticky top-0 z-10">
        <div>
        
          <h1 className="text-sm font-semibold text-foreground/90">Your Polls</h1>
        </div>
        <button
          type="button"
          onClick={() => openCreatePollModal()}
          className="flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-primary-foreground md:hidden"
        >
          <Plus className="size-3.5" />
          Create
        </button>
      </header>

      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-1.5">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all",
                      activeTab === tab.key
                        ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                        : "text-muted-foreground hover:text-foreground/75"
                    )}
                  >
                    <span>{tab.label}</span>
                    {tab.count > 0 ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                          activeTab === tab.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {[0, 1, 2].map((key) => (
                    <div
                      key={key}
                      className="h-44 animate-pulse rounded-[1.75rem] border border-border bg-secondary/30"
                    />
                  ))}
                </div>
              ) : null}

              {error && !isLoading ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4 text-sm text-red-500">
                  {error}
                </div>
              ) : null}

              {!isLoading && !error && filteredPolls.length === 0 ? (
                <div className="rounded-[2rem] border border-border bg-card p-12 text-center">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-primary/15 ring-1 ring-primary/25">
                    <ProductLogo size={32} />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-foreground/85">
                    {activeTab === "all" ? "No polls yet" : `No ${activeTab} polls`}
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    {activeTab === "all"
                      ? "Start with a poll name and choose AI or manual creation to launch your first poll."
                      : `You do not have ${activeTab} polls right now.`}
                  </p>
                  {activeTab === "all" ? (
                    <button
                      type="button"
                      onClick={() => openCreatePollModal()}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
                    >
                      <Plus className="size-4" />
                      Create Poll
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!isLoading && !error && filteredPolls.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredPolls.map((poll) => (
                    <PollCardV2 key={poll._id} poll={poll} />
                  ))}
                </div>
              ) : null}
      </div>

    </>
  );
}
