"use client";

import React from "react";
import { PollCard } from "@/features/polls/components/PollCard";
import type { Poll } from "@/features/polls/store/useCreatorStore";
import { PollCardModern } from "./PollCardModern";
import { PollCardGlass } from "./PollCardGlass";
import { PollCardMinimalist } from "./PollCardMinimalist";

const mockPolls: Poll[] = [
  {
    _id: "1",
    title: "How do you like the new UI features?",
    isAnonymous: false,
    expiresAt: new Date(Date.now() + 86400000 * 5).toISOString(),
    isPublished: true,
    questions: [
      { text: "Do you like it?", options: ["Yes", "No"], isMandatory: true },
      { text: "Rate it 1-5", options: ["1", "2", "3", "4", "5"], isMandatory: false },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    _id: "2",
    title: "Team Lunch Preferences for Friday",
    isAnonymous: true,
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
    isPublished: true,
    isClosed: true,
    questions: [
      { text: "Where to go?", options: ["Pizza", "Sushi", "Burgers"], isMandatory: true },
    ],
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    _id: "3",
    title: "Draft: Q3 Strategy Feedback",
    isAnonymous: false,
    expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    isPublished: false,
    questions: [
      { text: "Feedback?", options: [], isMandatory: true },
    ],
    createdAt: new Date().toISOString(),
  },
];

export default function TestCardPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black/95">
      <div className="container mx-auto py-16 px-4 space-y-24">
        <header className="max-w-2xl">
          <h1 className="text-4xl font-black tracking-tight mb-4">Component Lab: Poll Cards</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-lg">
            Experimenting with different card aesthetics for the Open Poll platform.
          </p>
        </header>

        <section>
          <div className="flex items-baseline justify-between mb-8 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <h2 className="text-2xl font-bold">01. Original Design</h2>
            <span className="text-xs font-mono text-zinc-400">Current implementation</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {mockPolls.map((poll) => (
              <PollCard key={poll._id} poll={poll} />
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-8 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <h2 className="text-2xl font-bold text-orange-600">02. Modern Bold</h2>
            <span className="text-xs font-mono text-zinc-400">Status-driven, tactile, depth</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {mockPolls.map((poll) => (
              <PollCardModern key={poll._id} poll={poll} />
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-8 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <h2 className="text-2xl font-bold text-blue-600">03. Glass Premium</h2>
            <span className="text-xs font-mono text-zinc-400">Transparency, gradients, large type</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {mockPolls.map((poll) => (
              <PollCardGlass key={poll._id} poll={poll} />
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-8 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <h2 className="text-2xl font-bold text-zinc-500">04. Minimalist List</h2>
            <span className="text-xs font-mono text-zinc-400">Clean, content-first, flat</span>
          </div>
          <div className="max-w-4xl space-y-4">
            {mockPolls.map((poll) => (
              <PollCardMinimalist key={poll._id} poll={poll} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
