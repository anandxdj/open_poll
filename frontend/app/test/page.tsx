"use client";

import React from "react";
import { 
  Plus, 
  BarChart3, 
  Share2, 
  Clock, 
  ListChecks, 
  Activity, 
  Users,
  Sparkles,
  ArrowUpRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

// --- Mock Data ---
const mockPolls = [
  {
    id: "1",
    title: "Q4 Product Roadmap Feedback",
    status: "active",
    questionsCount: 12,
    endDate: "Oct 14",
    responses: 402,
    isAiGenerated: true,
    liveParticipants: 4,
    recentTrend: [10, 25, 15, 40, 30, 60, 45],
  },
  {
    id: "2",
    title: "Employee Engagement Survey 2026",
    status: "active",
    questionsCount: 25,
    endDate: "Nov 01",
    responses: 890,
    isAiGenerated: false,
    liveParticipants: 12,
    recentTrend: [30, 40, 35, 50, 45, 55, 70],
  },
  {
    id: "3",
    title: "AI-Driven Analytics Feedback",
    status: "expired",
    questionsCount: 5,
    endDate: "May 10",
    responses: 110,
    isAiGenerated: true,
    liveParticipants: 0,
    recentTrend: [5, 10, 8, 15, 12, 10, 5],
  },
  {
    id: "4",
    title: "Selection of New CRM",
    status: "active",
    questionsCount: 8,
    endDate: "Dec 15",
    responses: 0,
    isAiGenerated: false,
    liveParticipants: 2,
    recentTrend: [0, 0, 0, 0, 0, 0, 0],
  }
];

// --- Minimal Components ---

const SparklineMinimal = ({ data, color }: { data: number[], color: string }) => {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-[1px] h-4 w-12 opacity-50 group-hover:opacity-100 transition-opacity">
      {data.map((val, i) => (
        <div
          key={i}
          style={{ height: `${(val / max) * 100}%` }}
          className={cn("w-[2px] rounded-full", color)}
        />
      ))}
    </div>
  );
};

const PollCardMinimal = ({ poll }: { poll: typeof mockPolls[0] }) => {
  const isActive = poll.status === "active";

  return (
    <div className="group relative py-8 border-b border-zinc-100 dark:border-zinc-900 last:border-0 transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 px-4 -mx-4 rounded-2xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        
        {/* Title & Status Area */}
        <div className="flex-grow max-w-xl">
          <div className="flex items-center gap-3 mb-2">
            {isActive && (
              <span className="flex size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            )}
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              isActive ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"
            )}>
              {isActive ? "Live" : "Ended"}
            </span>
            {poll.isAiGenerated && (
              <Sparkles className="size-3 text-blue-500/60" />
            )}
          </div>
          <h3 className="text-xl font-medium text-zinc-900 dark:text-zinc-100 tracking-tight">
            {poll.title}
          </h3>
        </div>

        {/* Stats Row */}
        <div className="flex flex-wrap items-center gap-8 md:gap-12">
          {/* Responses */}
          <div className="min-w-[80px]">
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter mb-1">Responses</div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {poll.responses}
              </span>
              <SparklineMinimal 
                data={poll.recentTrend} 
                color={isActive ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"} 
              />
            </div>
          </div>

          {/* Metadata */}
          <div className="hidden sm:block">
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter mb-1">Questions</div>
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{poll.questionsCount}</div>
          </div>

          <div className="hidden sm:block">
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter mb-1">Due Date</div>
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{poll.endDate}</div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost"
              size="sm"
              className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-full h-10 w-10 p-0"
            >
              <Share2 className="size-4" />
            </Button>
            <Button 
              className="bg-yellow-400 text-black hover:bg-yellow-500 font-bold rounded-full px-6 h-10 shadow-none border-none transition-all active:scale-95 flex items-center gap-2 group/btn"
            >
              Insights
              <ArrowUpRight className="size-4 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function CreatorDashboardPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black font-sans selection:bg-yellow-100 dark:selection:bg-yellow-900 pb-40">
      
      {/* Super Minimal Header */}
      <div className="border-b border-zinc-100 dark:border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
             <div className="size-8 bg-zinc-900 dark:bg-white rounded-lg flex items-center justify-center">
                <Activity className="size-5 text-white dark:text-black" />
             </div>
             <span className="font-bold tracking-tight text-zinc-900 dark:text-zinc-100">OpenPoll</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
             <a href="#" className="text-zinc-900 dark:text-zinc-100">Dashboard</a>
             <a href="#" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Surveys</a>
             <a href="#" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Team</a>
             <a href="#" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Settings</a>
          </nav>

          <div className="flex items-center gap-4">
             <div className="size-8 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800" />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-20">
        
        {/* Hero Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-12 mb-24">
          <div className="max-w-xl">
            <h1 className="text-5xl font-medium text-zinc-900 dark:text-zinc-50 tracking-tight leading-[1.1] mb-6">
              Create, analyze, and <span className="text-zinc-400">iterate.</span>
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-lg font-normal leading-relaxed">
              Your real-time feedback infrastructure. All deployments are running stable.
            </p>
          </div>
          
          <Button className="bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-100 font-bold rounded-full px-8 h-14 text-base shadow-none transition-all active:scale-95 flex items-center gap-3 group">
            <Plus className="size-5 group-hover:rotate-90 transition-transform" />
            New Poll
          </Button>
        </header>

        {/* Global Metrics - Ultra Thin */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-24 border-t border-zinc-100 dark:border-zinc-900 pt-12">
          {[
            { label: "Active Polls", value: "08" },
            { label: "Gross Responses", value: "12.4k" },
            { label: "Avg. Completion", value: "94%" },
            { label: "AI Tokens", value: "1.2m" },
          ].map((stat, i) => (
            <div key={i} className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{stat.label}</p>
              <p className="text-3xl font-medium text-zinc-900 dark:text-zinc-100 tracking-tighter">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* List Grid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900 pb-4 mb-4">
             <h2 className="text-[10px] font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-[0.2em]">Deployments</h2>
             <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Filter: All</div>
          </div>
          
          <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {mockPolls.map((poll) => (
              <PollCardMinimal key={poll.id} poll={poll} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
