"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, PencilLine, X, ArrowRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreatePollModalProps {
  open: boolean;
  onClose: () => void;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function CreatePollModal({ open, onClose }: CreatePollModalProps) {
  const router = useRouter();
  const [pollName, setPollName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void Promise.resolve().then(() => {
      setPollName("");
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
    const params = new URLSearchParams({ name: pollName.trim(), mode: "manual" });
    onClose();
    router.push(`/create?${params.toString()}`);
  }

  function handleAI() {
    if (!pollName.trim()) return;
    const params = new URLSearchParams({ name: pollName.trim(), mode: "ai" });
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
            className="fixed inset-0 z-[80] bg-foreground/40 backdrop-blur-[2px]"
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
            <div className="pointer-events-auto w-full max-w-md rounded-[2rem] border border-border bg-card shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 items-center justify-center rounded-xl bg-primary shadow-sm">
                    <Zap className="size-3.5 fill-primary-foreground text-primary-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground/90 leading-none">New Poll</p>
                    <p className="text-[10px] font-medium text-muted-foreground mt-0.5">Name your poll to get started</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="flex size-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-6 space-y-6">
                {/* Name input */}
                <div className="space-y-2">
                  <label htmlFor="create-poll-title" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Poll title
                  </label>
                  <input
                    id="create-poll-title"
                    ref={inputRef}
                    value={pollName}
                    onChange={(e) => setPollName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && valid) handleManual(); }}
                    placeholder="e.g. Team lunch preferences"
                    autoComplete="off"
                    className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/30 transition-all"
                  />
                </div>

                {/* Choice buttons */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    How do you want to create?
                  </p>

                  {/* AI option */}
                  <button
                    type="button"
                    disabled={!valid}
                    onClick={handleAI}
                    className={cn(
                      "group w-full flex items-center gap-4 rounded-2xl border p-4 transition-all duration-200 text-left",
                      valid
                        ? "border-primary/25 bg-primary/[0.06] hover:border-primary/50 hover:bg-primary/[0.1] cursor-pointer"
                        : "border-border bg-secondary/20 cursor-not-allowed opacity-40"
                    )}
                  >
                    <div className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
                      valid ? "bg-primary/20 group-hover:bg-primary/30" : "bg-secondary/30"
                    )}>
                      <Sparkles className={cn("size-5", valid ? "text-primary" : "text-muted-foreground/40")} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-bold leading-tight", valid ? "text-foreground/90" : "text-muted-foreground/50")}>
                        Generate with AI
                      </p>
                      <p className={cn("text-[11px] mt-0.5", valid ? "text-muted-foreground" : "text-muted-foreground/40")}>
                        Describe your topic and let AI build questions
                      </p>
                    </div>
                    <ArrowRight className={cn("size-4 shrink-0 transition-transform duration-200", valid ? "text-primary group-hover:translate-x-0.5" : "text-muted-foreground/30")} />
                  </button>

                  {/* Manual option */}
                  <button
                    type="button"
                    disabled={!valid}
                    onClick={handleManual}
                    className={cn(
                      "group w-full flex items-center gap-4 rounded-2xl border p-4 transition-all duration-200 text-left",
                      valid
                        ? "border-border bg-secondary/20 hover:border-border/80 hover:bg-secondary/40 cursor-pointer"
                        : "border-border bg-secondary/10 cursor-not-allowed opacity-40"
                    )}
                  >
                    <div className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
                      valid ? "bg-secondary/50 group-hover:bg-secondary/80" : "bg-secondary/20"
                    )}>
                      <PencilLine className={cn("size-5", valid ? "text-foreground/60" : "text-muted-foreground/30")} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-bold leading-tight", valid ? "text-foreground/90" : "text-muted-foreground/50")}>
                        Create manually
                      </p>
                      <p className={cn("text-[11px] mt-0.5", valid ? "text-muted-foreground" : "text-muted-foreground/40")}>
                        Write your own questions and options
                      </p>
                    </div>
                    <ArrowRight className={cn("size-4 shrink-0 transition-transform duration-200", valid ? "text-muted-foreground/50 group-hover:translate-x-0.5 group-hover:text-foreground/60" : "text-muted-foreground/20")} />
                  </button>
                </div>

                {!valid && pollName.length > 0 && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    Poll name needs at least 2 characters
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
