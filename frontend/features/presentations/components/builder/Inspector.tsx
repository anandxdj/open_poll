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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      className="rounded-xl border border-border bg-card shadow-[0_24px_48px_-32px_rgb(23_23_23/0.3)]"
    >
      {/* Slide type on the left, the inspector tabs as underline tabs on the right. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border px-5 pt-4 sm:px-6">
        <span className="inline-flex items-center gap-2 pb-3 text-sm font-medium text-foreground">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-accent-ink">
            <meta.Icon className="size-4" />
          </span>
          {meta.label}
          <span className="text-sm font-normal text-muted-foreground">
            {meta.scored ? "Scored" : isContentSlide(meta.type) ? "Content" : "Interactive"}
          </span>
        </span>

          {tabs.length > 1 && (
            <div
              role="tablist"
              aria-label="Slide inspector"
              className="-mb-px flex items-center gap-5"
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
                      "inline-flex items-center gap-1.5 border-b-2 pb-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      selected
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <tab.Icon className="size-4" />
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
          className="space-y-6 p-5 sm:p-6"
          {...(tabs.length > 1 && { role: "tabpanel", "aria-labelledby": `inspector-tab-${current.id}` })}
        >
          <current.Panel {...props} />
        </div>
      )}
    </motion.div>
  );
}
