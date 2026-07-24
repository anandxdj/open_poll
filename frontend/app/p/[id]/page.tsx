"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, ArrowRight, Lock, User, Mail, CheckCircle2 } from "lucide-react";
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
    const stored = sessionStorage.getItem(`openpoll_guest_${pollId}`);
    if (stored) {
      try {
        setGuestInfo(JSON.parse(stored));
      } catch {
        // ignore
      }
    }
  }, [pollId]);

  useEffect(() => {
    if (!pollId) return;
    const voted = localStorage.getItem(`openpoll_voted_${pollId}`) === "true";
    setHasVotedLocally(voted);
  }, [pollId]);

  useEffect(() => {
    if (!pollId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await apiClient.get<ApiOk<Poll>>(`/polls/${pollId}`);
        if (!cancelled) setPoll(res.data.data);
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
      toast.error("Please fill in both name and email.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(guestEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }

    const info = { name: guestName.trim(), email: guestEmail.trim() };
    sessionStorage.setItem(`openpoll_guest_${pollId}`, JSON.stringify(info));
    setGuestInfo(info);
    toast.success("Verification successful! You can now vote.");
  };

  if (!pollId) {
    return <PollClosed title="Invalid poll link." />;
  }

  // Loading skeleton
  if (loading || !deviceId || isAuthLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="size-10 rounded-xl bg-primary/20 flex items-center justify-center animate-pulse border border-primary/30">
            <Zap className="size-5 text-primary fill-primary" />
          </div>
          <p className="text-sm text-primary/40 animate-pulse font-medium">Loading poll…</p>
        </div>
      </div>
    );
  }

  if (notFound || !poll) {
    return <PollClosed title="This link is not valid." />;
  }

  // If results are published, or if the user has already voted, show results
  if (poll.isResultsPublished || hasVotedLocally) {
    return (
      <div className="relative min-h-screen bg-background flex flex-col">
        {hasVotedLocally && !poll.isResultsPublished && (
          <div className="relative z-50 bg-primary/10 border-b border-primary/20 text-center py-2.5 text-xs font-semibold text-primary backdrop-blur-md select-none flex items-center justify-center gap-1.5">
            <CheckCircle2 className="size-3.5" />
            <span>You have already participated. Showing live results so far!</span>
          </div>
        )}
        <div className="flex-1">
          <PublicResultsView poll={poll} />
        </div>
      </div>
    );
  }

  if (!votingOpen(poll)) {
    return <PollClosed title={poll.title} />;
  }

  const showGuestGate = !poll.isAnonymous && !isAuthenticated && !guestInfo;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary selection:text-primary-foreground">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-primary/[0.04] blur-[120px] rounded-full" />
      </div>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex items-start justify-center px-6 py-6">
        <div className="w-full max-w-lg space-y-8">
          {/* Poll title */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="space-y-2"
          >
            {showGuestGate ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-2.5 py-0.5 text-[10px] font-semibold text-primary select-none uppercase tracking-wider animate-pulse">
                <Lock className="size-3" /> Verification Required
              </div>
            ) : (
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                {poll.questions.length} Question{poll.questions.length !== 1 ? "s" : ""}
              </p>
            )}
            <h1 className="text-3xl font-bold tracking-tight text-foreground/90 leading-tight">
              {poll.title}
            </h1>
            <p className="text-sm text-muted-foreground/60">
              {showGuestGate
                ? "This is an authenticated poll. Please verify your details to participate as a guest."
                : "Select one answer per question — questions appear one at a time."}
            </p>
          </motion.div>

          {showGuestGate ? (
            /* Double Bezel Card for Guest Auth */
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease, delay: 0.1 }}
              className="relative group w-full"
            >
              <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-border/50 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="absolute inset-[1px] rounded-[23px] bg-background/50 backdrop-blur-2xl" />

              <div className="relative p-6 md:p-8 space-y-6">
                <form onSubmit={handleGuestSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="guestName" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                      <User className="size-3.5 text-primary/70" /> Full Name
                    </Label>
                    <Input
                      type="text"
                      id="guestName"
                      placeholder="Jane Doe"
                      className="bg-secondary/15 border-border/40 focus:border-primary/50 focus:ring-primary/20 h-11 px-4 rounded-xl text-foreground text-sm placeholder:text-muted-foreground/30 transition-all"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guestEmail" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                      <Mail className="size-3.5 text-primary/70" /> Email Address
                    </Label>
                    <Input
                      type="email"
                      id="guestEmail"
                      placeholder="jane@example.com"
                      className="bg-secondary/15 border-border/40 focus:border-primary/50 focus:ring-primary/20 h-11 px-4 rounded-xl text-foreground text-sm placeholder:text-muted-foreground/30 transition-all"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-11 rounded-xl bg-primary hover:bg-primary/95 text-primary-foreground font-semibold shadow-lg shadow-primary/10 hover:shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-2"
                  >
                    <span>Verify & Access Poll</span>
                    <ArrowRight className="size-4" />
                  </Button>
                </form>

                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-border/30"></div>
                  <span className="flex-shrink mx-4 text-[10px] font-bold text-muted-foreground/30 uppercase tracking-widest">Or</span>
                  <div className="flex-grow border-t border-border/30"></div>
                </div>

                <div className="text-center">
                  <Button
                    variant="link"
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors p-0 h-auto"
                    onClick={() => router.push(`/login?redirect=/p/${pollId}`)}
                  >
                    Log in with a creator account instead
                  </Button>
                </div>
              </div>
            </motion.div>
          ) : (
            /* Step form */
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease, delay: 0.1 }}
            >
              <StepByStepForm poll={poll} deviceId={deviceId} guestInfo={guestInfo} />
            </motion.div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-4 text-[10px] font-medium text-muted-foreground/30 uppercase tracking-widest">
        Powered by Open Poll
      </footer>
    </div>
  );
}
