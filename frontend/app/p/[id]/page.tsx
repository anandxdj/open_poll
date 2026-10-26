"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, CheckCircle2, Target } from "lucide-react";
import { toast } from "sonner";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { PollClosed } from "@/features/responses/components/PollClosed";
import { StepByStepForm } from "@/features/responses/components/StepByStepForm";
import { PublicResultsView } from "@/features/responses/components/PublicResultsView";
import { apiClient } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/features/landing/components/shared/PublicPageShell";

type ApiOk<T> = { success: boolean; message: string; data: T };

function votingOpen(poll: Poll) {
  if (!poll.isPublished || poll.isClosed) return false;
  return new Date(poll.expiresAt).getTime() > Date.now();
}

function useDeviceId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void Promise.resolve().then(() => {
      const key = "openpoll_device_id";
      let v = localStorage.getItem(key);
      if (!v) {
        v = crypto.randomUUID();
        localStorage.setItem(key, v);
      }
      setId(v);
    });
  }, []);
  return id;
}

function readStoredGuest(pollId: string): { name: string; email: string } | null {
  const stored = sessionStorage.getItem(`openpoll_guest_${pollId}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

const ease = [0.32, 0.72, 0, 1] as const;

export default function PublicPollPage() {
  const params = useParams();
  const router = useRouter();
  const pollId = typeof params?.id === "string" ? params.id : undefined;
  const deviceId = useDeviceId();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuthStore();

  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [hasVotedLocally, setHasVotedLocally] = useState(false);

  const [guestInfo, setGuestInfo] = useState<{ name: string; email: string } | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  useEffect(() => {
    if (!pollId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await apiClient.get<ApiOk<Poll>>(`/polls/${pollId}`);
        if (!cancelled) {
          // Browser-stored voter state is restored alongside the poll; the page
          // shows only the loader until then, so nothing renders stale.
          setGuestInfo(readStoredGuest(pollId));
          setHasVotedLocally(localStorage.getItem(`openpoll_voted_${pollId}`) === "true");
          setPoll(res.data.data);
        }
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setPoll(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pollId]);

  const handleGuestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim() || !guestEmail.trim()) {
      toast.error("Enter your name and email.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(guestEmail)) {
      toast.error("Enter a valid email address.");
      return;
    }

    const info = { name: guestName.trim(), email: guestEmail.trim() };
    sessionStorage.setItem(`openpoll_guest_${pollId}`, JSON.stringify(info));
    setGuestInfo(info);
    toast.success("Thanks. You can answer now.");
  };

  if (!pollId) {
    return <PollClosed title="This link isn't valid." hint="Check the link with the person who shared it." />;
  }

  const isQuiz = poll?.pollType === "TRIAL";
  const shellLabel = isQuiz ? "Quiz" : "Poll";
  const footer = { note: "Made with Open Poll", cta: "Make your own poll" };

  if (loading || !deviceId || isAuthLoading) {
    return (
      <PublicPageShell label="Poll">
        <div role="status" aria-label="Loading poll" className="space-y-4">
          <div className="h-10 w-3/4 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-8 space-y-2.5">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-14 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      </PublicPageShell>
    );
  }

  if (notFound || !poll) {
    return <PollClosed title="This link isn't valid." hint="Check the link with the person who shared it." />;
  }

  // If results are published, or if the user has already voted, show results
  if (poll.isResultsPublished || hasVotedLocally) {
    return (
      <PublicResultsView
        poll={poll}
        notice={
          hasVotedLocally && !poll.isResultsPublished ? (
            <p
              role="status"
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
            >
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
              You&apos;ve answered this poll. These are the results so far.
            </p>
          ) : null
        }
      />
    );
  }

  if (!votingOpen(poll)) {
    return <PollClosed title={poll.title} />;
  }

  const showGuestGate = !poll.isAnonymous && !isAuthenticated && !guestInfo;
  const count = poll.questions.length;

  return (
    <PublicPageShell label={shellLabel} footer={footer}>
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease }}
        className="space-y-3"
      >
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {showGuestGate ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground">
              <Lock className="size-3.5" aria-hidden /> Not anonymous
            </span>
          ) : isQuiz ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-foreground">
              <Target className="size-3.5 text-accent-ink" aria-hidden /> Pass mark{" "}
              <span className="font-mono tabular-nums">{poll.passingScorePercentage || 70}%</span>
            </span>
          ) : null}
          <span>
            <span className="font-mono tabular-nums text-foreground">{count}</span> question{count !== 1 ? "s" : ""}
          </span>
        </p>
        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">{poll.title}</h1>
        <p className="text-base text-muted-foreground">
          {showGuestGate
            ? "This poll records who answered. Add your name and email, or log in."
            : isQuiz
              ? "Answer each question. Your score shows when you finish."
              : "Pick an answer for each question. Questions come one at a time."}
        </p>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease, delay: 0.08 }}
        className="mt-8"
      >
        {showGuestGate ? (
          <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
            <form onSubmit={handleGuestSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="guestName">Full name</Label>
                <Input
                  type="text"
                  id="guestName"
                  autoComplete="name"
                  placeholder="Jane Doe"
                  className="h-11"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guestEmail">Email</Label>
                <Input
                  type="email"
                  id="guestEmail"
                  autoComplete="email"
                  placeholder="jane@example.com"
                  className="h-11"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" size="lg" className="mt-2 w-full">
                Continue to the {isQuiz ? "quiz" : "poll"}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-4 text-sm text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="outline"
              className="w-full bg-card"
              onClick={() => router.push(`/login?redirect=/p/${pollId}`)}
            >
              Log in with your account
            </Button>
          </div>
        ) : (
          <StepByStepForm poll={poll} deviceId={deviceId} guestInfo={guestInfo} />
        )}
      </motion.div>
    </PublicPageShell>
  );
}
