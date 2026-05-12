"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CalendarDays, Clock3, Plus } from "lucide-react";

import { useCreatorStore } from "@/features/polls/store/useCreatorStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PollsPage() {
  const { polls, isLoading, error, fetchPolls } = useCreatorStore();

  useEffect(() => {
    void fetchPolls();
  }, [fetchPolls]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-400">Creator Workspace</p>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-100">My Polls</h2>
        </div>
        <Button asChild>
          <Link href="/create">
            <Plus className="size-4" />
            New Poll
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-zinc-800 bg-slate-900/70 p-5 text-sm text-zinc-300">
          Loading polls...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-5 text-sm text-red-300">
          {error}
        </div>
      )}

      {!isLoading && !error && polls.length === 0 && (
        <Card className="border-zinc-800 bg-slate-900/60">
          <CardContent className="p-8 text-center">
            <h3 className="text-lg font-medium text-zinc-100">No polls yet</h3>
            <p className="mt-2 text-sm text-zinc-400">Create your first poll to start collecting responses.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && polls.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {polls.map((poll) => {
            const isClosed = !poll.isPublished;

            return (
              <Card key={poll._id} className="border-zinc-800 bg-slate-900/60">
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="line-clamp-2 text-base text-zinc-100">{poll.title}</CardTitle>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        isClosed
                          ? "bg-orange-950/70 text-orange-300"
                          : "bg-yellow-950/70 text-yellow-300"
                      }`}
                    >
                      {isClosed ? "Closed" : "Live"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-zinc-400">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="size-4" />
                    <span>{poll.questions.length} question(s)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock3 className="size-4" />
                    <span>
                      Created{" "}
                      {new Date(poll.createdAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="pt-1">
                    <Link className="text-orange-300 hover:text-yellow-200" href={`/analytics/${poll._id}`}>
                      View analytics
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
