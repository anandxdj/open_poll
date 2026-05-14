"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
  BarChart3, 
  Clock, 
  ExternalLink, 
  Globe, 
  Lock, 
  Share2, 
  X, 
  Trash2, 
  Users,
  MessageSquare
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

export function PollCardV2({ poll, liveVotes = 0 }: { poll: Poll; liveVotes?: number }) {
  const { closePoll, deletePoll } = useCreatorStore();
  const status = pollStatus(poll);
  const cfg = statusConfig[status];
  const [countdown, setCountdown] = useState(() =>
    status === "active" ? formatCountdown(poll.expiresAt) : null
  );
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (status !== "active") return;
    const tick = () => setCountdown(formatCountdown(poll.expiresAt));
    void Promise.resolve().then(tick);
    const id = window.setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [poll.expiresAt, status]);

  async function handleClose() {
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

  async function handleDelete() {
    setDeleting(true);
    try {
      await deletePoll(poll._id);
      toast.success("Poll deleted.");
    } catch {
      toast.error("Couldn't delete poll.");
    } finally {
      setDeleting(false);
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
        "group relative flex flex-col rounded-[2rem] border border-border bg-card p-6 transition-all duration-300",
        "hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
      )}
    >
      {/* Status & Delete */}
      <div className="flex items-center justify-between mb-4">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
            cfg.badgeClass
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              cfg.dot,
              status === "active" && "motion-safe:animate-pulse"
            )}
          />
          {cfg.label}
        </span>
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              disabled={deleting}
              className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/5 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="rounded-3xl border-border bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-bold">Delete Poll?</AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground">
                This action cannot be undone. All responses and analytics for <strong>"{poll.title}"</strong> will be permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 gap-3">
              <AlertDialogCancel className="rounded-xl border-border bg-secondary/50 hover:bg-secondary">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="rounded-xl bg-red-500 font-bold text-white hover:bg-red-600 transition-colors"
              >
                Delete Poll
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Main Content */}
      <div className="mb-5">
        <h3 className="line-clamp-1 text-lg font-bold tracking-tight text-foreground/90 mb-1.5">
          {poll.title}
        </h3>
        <div className="flex items-center gap-3 text-xs font-semibold text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3" />
            {poll.questions.length}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3" />
            {liveVotes}
          </span>
          {status === "active" && countdown && (
            <span className="flex items-center gap-1 text-primary/80">
              <Clock className="size-3" />
              {countdown}
            </span>
          )}
        </div>
      </div>

      {/* Progress */}
      {status === "active" && (
        <div className="w-full bg-secondary/30 rounded-full h-1 mb-6">
          <div className="bg-primary h-1 rounded-full w-2/3" />
        </div>
      )}

      {/* Primary Actions */}
      <div className="grid grid-cols-2 gap-2.5">
        {status === "draft" ? (
          <Link
            href={`/create?draftId=${poll._id}`}
            className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:opacity-90"
          >
            Edit Draft
          </Link>
        ) : (
          <>
            <Link
              href={`/analytics/${poll._id}`}
              className="flex items-center justify-center gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-xs font-bold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <BarChart3 className="size-3.5" />
              Analytics
            </Link>

            <button
              type="button"
              onClick={handleShare}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-transform active:scale-95",
                poll.isResultsPublished 
                  ? "bg-emerald-500 text-white" 
                  : "bg-primary text-primary-foreground"
              )}
            >
              <Share2 className="size-3.5" />
              {poll.isResultsPublished ? "Share Results" : "Share Poll"}
            </button>
          </>
        )}
      </div>

      {/* Subtle Footer */}
      <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50">
        <Link
          href={`/p/${poll._id}`}
          target="_blank"
          className="text-[10px] font-bold text-muted-foreground/40 hover:text-primary transition-colors uppercase tracking-widest"
        >
          View Live
        </Link>
        
        {status === "active" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={closing}
                className="text-[10px] font-bold text-red-500/50 hover:text-red-500 uppercase tracking-widest transition-colors"
              >
                {closing ? "Closing…" : "Close Poll"}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-3xl border-border bg-card">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-xl font-bold">Close Poll?</AlertDialogTitle>
                <AlertDialogDescription className="text-sm text-muted-foreground">
                  This will stop accepting new responses for <strong>"{poll.title}"</strong>. This action can be reversed by extending the expiry date later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-4 gap-3">
                <AlertDialogCancel className="rounded-xl border-border bg-secondary/50 hover:bg-secondary">
                  Keep Active
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClose}
                  className="rounded-xl bg-red-500 font-bold text-white hover:bg-red-600 transition-colors"
                >
                  Close Poll
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </article>
  );
}
