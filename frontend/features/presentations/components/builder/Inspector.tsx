"use client";

import { useState, type KeyboardEvent } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { isContentSlide, slideTypeMeta } from "../../slides/meta";
import { inspectorTabsFor, type InspectorTabProps } from "./inspectorTabs";

const ease = [0.32, 0.72, 0, 1] as const;

/**
 * Edits the selected slide through the tabs in the `inspectorTabs` registry.
 * The chosen tab sticks while switching slides, falling back to the first tab
 * when the chosen one doesn't apply to the new slide.
 */
export function Inspector(props: InspectorTabProps) {
  const { slide, index } = props;
  const meta = slideTypeMeta(slide.type);
  const tabs = inspectorTabsFor(slide);
  const [chosen, setChosen] = useState(tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === chosen) ?? tabs[0];

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, position: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (position + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (position - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    setChosen(tabs[next].id);
    document.getElementById(`inspector-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <motion.div
      key={index}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className="flex-1 min-h-0 flex flex-col p-1.5 rounded-[2rem] bg-white/5 border border-white/10 overflow-hidden h-full"
    >
      <div className="rounded-[1.625rem] bg-card p-5 sm:p-6 space-y-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/4 border border-white/10 px-4 py-2 text-xs font-semibold text-foreground/85">
            <meta.Icon className={`size-3.5 ${meta.iconClass}`} /> {meta.label}
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 ml-1">
              {meta.scored ? "Scored" : isContentSlide(meta.type) ? "Content" : "Interactive"}
            </span>
          </span>

          {tabs.length > 1 && (
            <div
              role="tablist"
              aria-label="Slide inspector"
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/3 p-1"
            >
              {tabs.map((tab, position) => {
                const selected = tab.id === current?.id;
                return (
                  <button
                    key={tab.id}
                    id={`inspector-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`inspector-panel-${tab.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setChosen(tab.id)}
                    onKeyDown={(e) => onTabKeyDown(e, position)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      selected
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-white/6 hover:text-foreground"
                    )}
                  >
                    <tab.Icon className="size-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {current && (
          <div
            id={`inspector-panel-${current.id}`}
            {...(tabs.length > 1 && { role: "tabpanel", "aria-labelledby": `inspector-tab-${current.id}` })}
          >
            <current.Panel {...props} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
