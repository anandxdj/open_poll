"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { Poll } from "@/features/polls/store/useCreatorStore";

interface AnalyticsHeaderStatsProps {
  poll: Poll;
  totalResponses: number;
}

/** The poll's facts as one hairline strip: responses, status, who can answer, when it was made. */
export function AnalyticsHeaderStats({ poll, totalResponses }: AnalyticsHeaderStatsProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const isExpired = new Date(poll.expiresAt).getTime() < nowMs;
  const status = poll.isClosed ? "Closed" : isExpired ? "Expired" : "Live";

  const stats: { label: string; value: string | number; sub?: string; live?: boolean; number?: boolean }[] = [
    { label: "Responses", value: totalResponses, number: true },
    {
      label: "Status",
      value: status,
      live: status === "Live",
      sub:
        status === "Live"
          ? `Ends in ${formatDistanceToNow(new Date(poll.expiresAt))}`
          : `Ended ${formatDistanceToNow(new Date(poll.expiresAt))} ago`,
    },
    {
      label: "Respondents",
      value: poll.isAnonymous ? "Anonymous" : "Identified",
      sub: poll.isAnonymous ? "No identity collected" : "Name and email required",
    },
    { label: "Created", value: new Date(poll.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" }) },
  ];

  return (
    <dl className="grid grid-cols-2 border-y border-border lg:grid-cols-4">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={cn(
            "py-4 sm:py-5",
            i % 2 === 1 && "border-l border-border pl-4 sm:pl-6",
            i === 2 && "border-t border-border lg:border-t-0 lg:border-l lg:pl-6",
            i === 3 && "border-t border-border lg:border-t-0",
          )}
        >
          <dt className="flex items-center gap-2 text-sm text-muted-foreground">
            {stat.live !== undefined ? (
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", stat.live ? "bg-success motion-safe:animate-pulse" : "bg-faint")}
              />
            ) : null}
            {stat.label}
          </dt>
          <dd
            className={cn(
              "mt-1.5 font-semibold leading-none tracking-[-0.03em]",
              stat.number ? "text-4xl" : "text-2xl",
            )}
          >
            {stat.value}
          </dd>
          {stat.sub ? <p className="mt-2 text-sm text-muted-foreground">{stat.sub}</p> : null}
        </div>
      ))}
    </dl>
  );
}
