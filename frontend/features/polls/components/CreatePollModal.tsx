"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, PencilLine, X, ArrowRight, BarChart2, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreatePollModalProps {
  open: boolean;
  onClose: () => void;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function CreatePollModal({ open, onClose }: CreatePollModalProps) {
  const router = useRouter();
  const [pollName, setPollName] = useState("");
  const [pollType, setPollType] = useState<"POLL" | "TRIAL">("POLL");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void Promise.resolve().then(() => {
      setPollName("");
      setPollType("POLL");
      setTimeout(() => inputRef.current?.focus(), 120);
    });
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function handleManual() {
    if (!pollName.trim()) return;
    const params = new URLSearchParams({ name: pollName.trim(), mode: "manual", pollType });
    onClose();
    router.push(`/create?${params.toString()}`);
  }

  function handleAI() {
    if (!pollName.trim()) return;
    const params = new URLSearchParams({ name: pollName.trim(), mode: "ai", pollType });
    onClose();
    router.push(`/create?${params.toString()}`);
  }

  const valid = pollName.trim().length >= 2;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[80] bg-black/50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.28, ease }}
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-poll-heading"
              className="pointer-events-auto w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-xl shadow-black/15"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
                <div>
                  <h2 id="create-poll-heading" className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {pollType === "TRIAL" ? "New assessment" : "New poll"}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Pick a type, name it, then choose how to start.</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Body */}
              <div className="space-y-6 px-6 py-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Type</p>
                  <div role="group" aria-label="Type" className="grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-secondary p-0.5">
                    {(
                      [
                        { type: "POLL", Icon: BarChart2, label: "Standard poll" },
                        { type: "TRIAL", Icon: Target, label: "Assessment trial" },
                      ] as const
                    ).map(({ type, Icon, label }) => {
                      const on = pollType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setPollType(type)}
                          className={cn(
                            "flex h-8 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                            on ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className={cn("size-4", on && "text-accent-ink")} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="create-poll-title" className="text-sm font-medium text-foreground">
                    {pollType === "TRIAL" ? "Assessment title" : "Poll title"}
                  </label>
                  <input
                    id="create-poll-title"
                    ref={inputRef}
                    value={pollName}
                    onChange={(e) => setPollName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && valid) handleManual(); }}
                    placeholder={pollType === "TRIAL" ? "e.g. TypeScript fundamentals" : "e.g. Team lunch preferences"}
                    autoComplete="off"
                    className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                  />
                </div>

                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium text-foreground">How do you want to start?</legend>
                  {(
                    [
                      { key: "ai", Icon: Sparkles, title: "Generate with AI", body: "Describe your topic and let AI build questions", run: handleAI },
                      { key: "manual", Icon: PencilLine, title: "Build manually", body: "Write your own questions and options", run: handleManual },
                    ] as const
                  ).map(({ key, Icon, title, body, run }) => (
                    <button
                      key={key}
                      type="button"
                      disabled={!valid}
                      onClick={run}
                      className="group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors duration-150 hover:border-foreground/25 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-accent-ink">
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">{title}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{body}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </button>
                  ))}
                </fieldset>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
