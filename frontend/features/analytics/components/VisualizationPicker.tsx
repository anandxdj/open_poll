"use client";

import { BarChart2, List, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";

export type VisualizationType = "bar-v" | "bar-h" | "pie" | "list";

interface VisualizationPickerProps {
  value: VisualizationType;
  onChange: (value: VisualizationType) => void;
}

export function VisualizationPicker({ value, onChange }: VisualizationPickerProps) {
  const options = [
    { id: "bar-v", icon: BarChart2, label: "Vertical Bar" },
    { id: "bar-h", icon: BarChart2, label: "Horizontal Bar", rotate: true },
    { id: "pie", icon: PieChart, label: "Donut Chart" },
    { id: "list", icon: List, label: "List View" },
  ];

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-border/80 bg-secondary/60 p-1 backdrop-blur-md shadow-sm">
      {options.map((opt) => {
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id as VisualizationType)}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg transition-all cursor-pointer select-none",
              isActive
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 scale-[1.05]"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground active:scale-[0.95]"
            )}
            title={opt.label}
            aria-label={opt.label}
          >
            <opt.icon className={cn("size-4 shrink-0", opt.rotate && "rotate-90")} />
          </button>
        );
      })}
    </div>
  );
}
