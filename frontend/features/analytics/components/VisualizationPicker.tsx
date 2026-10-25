"use client";

import { BarChart2, List, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";

export type VisualizationType = "bar-v" | "bar-h" | "pie" | "list";

interface VisualizationPickerProps {
  value: VisualizationType;
  onChange: (value: VisualizationType) => void;
}

const OPTIONS: { id: VisualizationType; icon: typeof BarChart2; label: string; rotate?: boolean }[] = [
  { id: "bar-h", icon: BarChart2, label: "Bars", rotate: true },
  { id: "bar-v", icon: BarChart2, label: "Columns" },
  { id: "pie", icon: PieChart, label: "Donut" },
  { id: "list", icon: List, label: "List" },
];

/** How every question chart on the page is drawn: a segmented control of pressed buttons. */
export function VisualizationPicker({ value, onChange }: VisualizationPickerProps) {
  return (
    <div role="group" aria-label="Chart type" className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
      {OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
              active ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <opt.icon className={cn("size-4 shrink-0", opt.rotate && "rotate-90", active && "text-accent-ink")} aria-hidden="true" />
            <span className="hidden sm:inline">{opt.label}</span>
            <span className="sr-only sm:hidden">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
