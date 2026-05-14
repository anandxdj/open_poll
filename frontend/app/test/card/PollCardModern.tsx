"use client";

import Link from "next/link";
import { Calendar, BarChart, MoreHorizontal, Users, HelpCircle } from "lucide-react";
import { motion } from "framer-motion";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function getPollStatus(poll: Poll) {
  if (!poll.isPublished) return { label: "Draft", color: "gray" };
  const closed = poll.isClosed === true;
  const expired = new Date(poll.expiresAt).getTime() <= Date.now();
  if (closed || expired) return { label: "Ended", color: "red" };
  return { label: "Live", color: "orange" };
}

export function PollCardModern({ poll }: { poll: Poll }) {
  const status = getPollStatus(poll);

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="h-full"
    >
      <Card className="h-full flex flex-col border-none ring-1 ring-black/5 dark:ring-white/10 shadow-sm hover:shadow-md transition-shadow duration-300 bg-white dark:bg-zinc-900 overflow-hidden rounded-2xl">
        {/* Status Accent Bar */}
        <div 
          className={cn(
            "h-1.5 w-full",
            status.color === "orange" && "bg-orange-500",
            status.color === "red" && "bg-zinc-400 dark:bg-zinc-600",
            status.color === "gray" && "bg-zinc-200 dark:bg-zinc-800"
          )} 
        />
        
        <div className="p-5 flex flex-col flex-grow">
          <div className="flex justify-between items-start mb-4">
            <div className={cn(
              "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
              status.color === "orange" && "bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400",
              status.color === "red" && "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
              status.color === "gray" && "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
            )}>
              {status.label}
            </div>
            <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
              <MoreHorizontal className="size-5" />
            </button>
          </div>

          <h3 className="text-lg font-bold leading-tight mb-3 text-zinc-800 dark:text-zinc-100 line-clamp-2">
            {poll.title}
          </h3>

          <div className="mt-auto space-y-3">
            <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="size-3.5" />
                <span>{poll.questions.length} Questions</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                <span>{new Date(poll.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
            </div>

            {status.color === "orange" && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-medium text-zinc-400">
                  <span>Time Remaining</span>
                  <span>72%</span>
                </div>
                <div className="h-1 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: "72%" }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className="h-full bg-orange-500" 
                  />
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
               <div className="flex -space-x-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="size-6 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                       <Users className="size-3 text-zinc-400" />
                    </div>
                  ))}
                  <div className="size-6 rounded-full border-2 border-white dark:border-zinc-900 bg-orange-50 dark:bg-orange-950 flex items-center justify-center text-[8px] font-bold text-orange-600 dark:text-orange-400">
                    +12
                  </div>
               </div>

               <Button
                asChild
                size="sm"
                className="rounded-xl font-semibold bg-orange-500 hover:bg-orange-600 text-white shadow-sm shadow-orange-200 dark:shadow-none transition-all active:scale-95"
              >
                <Link href={`/analytics/${poll._id}`}>
                  View Details
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
