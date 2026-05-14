"use client";

import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { Card } from "@/components/ui/card";

export function PollCardMinimalist({ poll }: { poll: Poll }) {
  return (
    <Card className="group p-0 overflow-hidden border-zinc-200 dark:border-zinc-800 bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors border-0 border-b rounded-none shadow-none">
      <div className="py-6 flex items-start gap-6">
        <div className="size-12 rounded-2xl bg-orange-100 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
          <MessageSquare className="size-6 text-orange-600 dark:text-orange-400" />
        </div>
        
        <div className="flex-grow">
          <div className="flex items-center gap-3 mb-1">
             <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
               {new Date(poll.createdAt).toLocaleDateString()}
             </span>
             <span className="size-1 rounded-full bg-zinc-300" />
             <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">
               {poll.isPublished ? "Public" : "Draft"}
             </span>
          </div>
          
          <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2 group-hover:underline decoration-orange-500 underline-offset-4">
            {poll.title}
          </h3>
          
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {poll.questions.length} sections to complete
          </div>
        </div>

        <Link 
          href={`/analytics/${poll._id}`}
          className="size-10 rounded-full border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-900 dark:hover:bg-zinc-100 hover:text-white dark:hover:text-zinc-900 transition-all active:scale-90"
        >
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </Card>
  );
}
