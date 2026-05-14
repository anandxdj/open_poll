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
    { id: "bar-v", icon: BarChart2, label: "Vertical" },
    { id: "bar-h", icon: BarChart2, label: "Horizontal", rotate: true },
    { id: "pie", icon: PieChart, label: "Donut" },
    { id: "list", icon: List, label: "List" },
  ];

  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-[#0d0d0d] p-1">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id as VisualizationType)}
          className={cn(
            "flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-all",
            value === opt.id
              ? "bg-primary text-primary-foreground shadow-lg"
              : "text-white/40 hover:bg-white/[0.04] hover:text-white/70"
          )}
          title={opt.label}
        >
          <opt.icon className={cn("size-3.5", opt.rotate && "rotate-90")} />
          <span className="hidden sm:inline">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
