"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Copy, Layers, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { slideTypeMeta } from "../slideTypeMeta";
import type { Presentation, PresentationStatus } from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

const statusChip: Record<PresentationStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-white/5 text-white/50 border-white/10" },
  lobby: { label: "Lobby open", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  question: { label: "Live", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  reveal: { label: "Live", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  leaderboard: { label: "Live", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  ended: { label: "Ended", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
};

interface PresentationCardProps {
  presentation: Presentation;
  index?: number;
  onDelete: (presentation: Presentation) => void;
}

export function PresentationCard({ presentation, index = 0, onDelete }: PresentationCardProps) {
  const router = useRouter();
  const chip = statusChip[presentation.status];
  const typeIcons = [...new Set(presentation.slides.map((s) => s.type))].slice(0, 6);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: index * 0.05 }}
      className="p-1.5 rounded-[2rem] bg-white/5 border border-white/10"
    >
      <div className="rounded-[calc(2rem-0.375rem)] bg-card p-5 space-y-4 h-full flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight text-foreground/90 leading-snug">
            {presentation.title}
          </h2>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${chip.className}`}
          >
            {chip.label}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
          <span className="flex items-center gap-1.5">
            <Layers className="size-3.5" /> {presentation.slides.length} slide
            {presentation.slides.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            {typeIcons.map((type) => {
              const m = slideTypeMeta(type);
              return <m.Icon key={type} className={`size-3.5 ${m.iconClass}`} />;
            })}
          </span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(presentation.joinCode);
              toast.success("Join code copied!");
            }}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors ml-auto"
            title="Copy join code"
          >
            <Copy className="size-3" />
            <span className="font-mono font-bold tracking-widest">{presentation.joinCode}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1 mt-auto">
          <Button
            onClick={() => router.push(`/presentation/host/${presentation._id}`)}
            className="h-9 rounded-full bg-primary text-primary-foreground font-semibold px-4 text-xs"
          >
            <Play className="size-3.5 mr-1.5" /> Host live
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/presentation/create?id=${presentation._id}`)}
            className="h-9 rounded-full px-4 text-xs font-semibold border-white/15"
          >
            <Pencil className="size-3.5 mr-1.5" /> Edit
          </Button>
          <Button
            variant="ghost"
            onClick={() => onDelete(presentation)}
            className="h-9 rounded-full px-3 text-xs text-muted-foreground/60 hover:text-red-400 ml-auto"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export const QuizCard = PresentationCard;
