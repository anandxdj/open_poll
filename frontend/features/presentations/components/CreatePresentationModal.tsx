"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, PencilLine, X, ArrowRight } from "lucide-react";

interface CreatePresentationModalProps {
  open: boolean;
  onClose: () => void;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function CreatePresentationModal({ open, onClose }: CreatePresentationModalProps) {
  const router = useRouter();
  const [deckName, setDeckName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void Promise.resolve().then(() => {
      setDeckName("");
      setTimeout(() => inputRef.current?.focus(), 120);
    });
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function go(mode: "manual" | "ai") {
    if (!deckName.trim()) return;
    const params = new URLSearchParams({ name: deckName.trim(), mode });
    onClose();
    router.push(`/presentation/create?${params.toString()}`);
  }

  const valid = deckName.trim().length >= 2;

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
              aria-labelledby="create-deck-heading"
              className="pointer-events-auto w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-xl shadow-black/15"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
                <div>
                  <h2 id="create-deck-heading" className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                    New deck
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Name it, then choose how to start.</p>
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
                  <label htmlFor="create-deck-title" className="text-sm font-medium text-foreground">
                    Deck title
                  </label>
                  <input
                    id="create-deck-title"
                    ref={inputRef}
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && valid) go("manual"); }}
                    placeholder="e.g. Quarterly all-hands"
                    autoComplete="off"
                    className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                  />
                  {!valid && deckName.length > 0 ? (
                    <p className="text-sm text-muted-foreground">Deck title needs at least 2 characters</p>
                  ) : null}
                </div>

                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium text-foreground">How do you want to start?</legend>
                  {(
                    [
                      { mode: "ai", Icon: Sparkles, title: "Generate with AI", body: "Describe a topic and let AI draft the slides" },
                      { mode: "manual", Icon: PencilLine, title: "Build manually", body: "Pick slide types and write your own questions" },
                    ] as const
                  ).map(({ mode, Icon, title, body }) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={!valid}
                      onClick={() => go(mode)}
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
