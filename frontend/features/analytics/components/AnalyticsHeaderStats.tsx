"use client";

import { Calendar, Clock, Shield, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Poll } from "@/features/polls/store/useCreatorStore";

interface AnalyticsHeaderStatsProps {
  poll: Poll;
  totalResponses: number;
}

export function AnalyticsHeaderStats({ poll, totalResponses }: AnalyticsHeaderStatsProps) {
  const isExpired = new Date(poll.expiresAt).getTime() < Date.now();
  const status = poll.isClosed ? "Closed" : isExpired ? "Expired" : "Live";
  
  const stats = [
    {
      label: "Total Responses",
      value: totalResponses,
      icon: Users,
      color: "text-primary",
    },
    {
      label: "Status",
      value: status,
      icon: Clock,
      color: status === "Live" ? "text-emerald-400" : "text-white/40",
      sub: status === "Live" 
        ? `Ends in ${formatDistanceToNow(new Date(poll.expiresAt))}` 
        : `Ended ${formatDistanceToNow(new Date(poll.expiresAt))} ago`,
    },
    {
      label: "Response Mode",
      value: poll.isAnonymous ? "Anonymous" : "Authenticated",
      icon: Shield,
      color: "text-primary/70",
      sub: poll.isAnonymous ? "No identity collected" : "Email required",
    },
    {
      label: "Created",
      value: new Date(poll.createdAt).toLocaleDateString(),
      icon: Calendar,
      color: "text-white/40",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bezel-outer">
          <div className="bezel-inner flex h-full flex-col justify-between p-5">
            <div className="flex items-start justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                {stat.label}
              </p>
              <stat.icon className={stat.color + " size-4"} strokeWidth={1.5} />
            </div>
            <div className="mt-3 space-y-0.5">
              <p className="text-2xl font-bold tracking-tight text-white/90">{stat.value}</p>
              {stat.sub && <p className="text-[10px] text-white/20">{stat.sub}</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
