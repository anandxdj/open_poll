"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Clock, ExternalLink, Globe, Lock, Share2, X } from "lucide-react";
import { toast } from "sonner";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { useCreatorStore } from "@/features/polls/store/useCreatorStore";
import { cn } from "@/lib/utils";

function pollStatus(poll: Poll): "active" | "expired" | "draft" {
  if (!poll.isPublished) return "draft";
  const closed = poll.isClosed === true;
  const expired = new Date(poll.expiresAt).getTime() <= Date.now();
  if (closed || expired) return "expired";
  return "active";
}

function formatCountdown(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Closed";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `Closes in ${Math.floor(h / 24)}d`;
  if (h > 0) return `Closes in ${h}h ${m}m`;
  return `Closes in ${m}m`;
}

const statusConfig = {
  active: {
    label: "Active",
    badgeClass: "border-primary/25 bg-primary/[0.12] text-primary",
    dot: "bg-primary",
  },
  expired: {
    label: "Expired",
    badgeClass: "border-border bg-secondary/30 text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  draft: {
    label: "Draft",
    badgeClass: "border-primary/35 bg-primary/10 text-primary",
    dot: "bg-primary",
  },
};

export function PollCard({ poll, liveVotes }: { poll: Poll; liveVotes?: number }) {
  const { closePoll } = useCreatorStore();
  const status = pollStatus(poll);
  const cfg = statusConfig[status];
  const [countdown, setCountdown] = useState(() =>
    status === "active" ? formatCountdown(poll.expiresAt) : null
  );
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (status !== "active") return;
    const tick = () => setCountdown(formatCountdown(poll.expiresAt));
    void Promise.resolve().then(tick);
    const id = window.setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [poll.expiresAt, status]);

  async function handleClose(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm(`Close "${poll.title}" now?`)) return;
    setClosing(true);
    try {
      await closePoll(poll._id);
      toast.success("Poll closed.");
    } catch {
      toast.error("Couldn't close poll.");
    } finally {
      setClosing(false);
    }
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    const url = `${window.location.origin}/p/${poll._id}`;
    await navigator.clipboard.writeText(url);
    toast.success("Poll link copied!");
  }

  const responseMode = poll.isAnonymous ? "anonymous" : "authenticated";

  return (
    <article
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors duration-200",
        "hover:border-primary/20"
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide",
              cfg.badgeClass
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                cfg.dot,
                status === "active" && "motion-safe:animate-pulse"
              )}
              aria-hidden
            />
            {cfg.label}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              responseMode === "anonymous"
                ? "border-border bg-secondary/30 text-muted-foreground"
                : "border-primary/20 bg-primary/[0.08] text-primary/90"
            )}
          >
            {responseMode === "anonymous" ? (
              <>
                <Globe className="size-3 shrink-0 opacity-80" aria-hidden />
                ANON
              </>
            ) : (
              <>
                <Lock className="size-3 shrink-0 opacity-80" aria-hidden />
                Auth
              </>
            )}
          </span>
        </div>

        <div className="space-y-1">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-foreground/90">
            {poll.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {poll.questions.length} question{poll.questions.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {status === "active" && countdown && (
            <span className="inline-flex items-center gap-1 text-primary/85">
              <Clock className="size-3 shrink-0" aria-hidden />
              {countdown}
            </span>
          )}
          {liveVotes !== undefined && status === "active" && (
            <span className="inline-flex items-center gap-1.5 text-primary/90">
              <span className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden />
              {liveVotes} votes
            </span>
          )}
        </div>

        {status === "active" && (
          <div
            className="h-0.5 overflow-hidden rounded-full bg-muted"
            role="presentation"
            aria-hidden
          >
            <div className="h-full w-2/5 rounded-full bg-primary/35" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-0.5">
          {status === "draft" ? (
            <Link
              href={`/create?draftId=${poll._id}`}
              className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl border border-primary/25 bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
            >
              Edit Draft
            </Link>
          ) : (
            <>
              <Link
                href={`/analytics/${poll._id}`}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:border-border/80 hover:bg-secondary/80 hover:text-foreground"
              >
                <BarChart3 className="size-3.5 shrink-0 opacity-90" aria-hidden />
                Analytics
              </Link>

              <button
                type="button"
                onClick={handleShare}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/25 bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
              >
                <Share2 className="size-3.5 shrink-0" aria-hidden />
                Share
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground/60">
          {status !== "draft" ? (
            <Link
              href={`/p/${poll._id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground/60"
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden />
              Open as respondent
            </Link>
          ) : (
            <span />
          )}
          {status === "active" && (
            <button
              type="button"
              onClick={handleClose}
              disabled={closing}
              className="inline-flex items-center gap-1 transition-colors hover:text-red-500 disabled:opacity-40"
            >
              <X className="size-3 shrink-0" aria-hidden />
              {closing ? "Closing…" : "Close poll"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
