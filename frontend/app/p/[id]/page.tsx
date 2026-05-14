"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Zap } from "lucide-react";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { PollClosed } from "@/features/responses/components/PollClosed";
import { StepByStepForm } from "@/features/responses/components/StepByStepForm";
import { PublicResultsView } from "@/features/responses/components/PublicResultsView";
import { apiClient } from "@/lib/api-client";

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
  const pollId = typeof params?.id === "string" ? params.id : undefined;
  const deviceId = useDeviceId();

  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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

  if (!pollId) {
    return <PollClosed title="Invalid poll link." />;
  }

  // Loading skeleton
  if (loading || !deviceId) {
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

  // If results are published, show results instead of the voting form
  if (poll.isResultsPublished) {
    return <PublicResultsView poll={poll} />;
  }

  if (!votingOpen(poll)) {
    return <PollClosed title={poll.title} />;
  }

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
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
              {poll.questions.length} Question{poll.questions.length !== 1 ? "s" : ""}
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-foreground/90 leading-tight">
              {poll.title}
            </h1>
            <p className="text-sm text-muted-foreground/60">
              Select one answer per question — questions appear one at a time.
            </p>
          </motion.div>

          {/* Step form */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease, delay: 0.1 }}
          >
            <StepByStepForm poll={poll} deviceId={deviceId} />
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-4 text-[10px] font-medium text-muted-foreground/30 uppercase tracking-widest">
        Powered by Open Poll
      </footer>
    </div>
  );
}
