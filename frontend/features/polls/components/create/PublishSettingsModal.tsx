"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CalendarClock, Eye, Loader2, Send, Shield, UserRound, X, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DateTimePicker } from "@/components/ui/date-time-picker";

interface PublishSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  isLoading: boolean;
  // settings
  expiresAtLocal: string;
  onExpiresChange: (v: string) => void;
  isAnonymous: boolean;
  onAnonymousChange: (v: boolean) => void;
  isPublished: boolean;
  onPublishedChange: (v: boolean) => void;
  pollTitle: string;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function PublishSettingsModal({
  open,
  onClose,
  onConfirm,
  isLoading,
  expiresAtLocal,
  onExpiresChange,
  isAnonymous,
  onAnonymousChange,
  isPublished,
  onPublishedChange,
  pollTitle,
}: PublishSettingsModalProps) {

  async function handleConfirm() {
    await onConfirm();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="pub-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm"
            onClick={!isLoading ? onClose : undefined}
          />

          {/* Sheet */}
          <motion.div
            key="pub-modal"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.3, ease }}
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-md rounded-[2rem] border border-border bg-card shadow-[0_32px_80px_rgba(0,0,0,0.85)] overflow-hidden">

              {/* Header */}
              <div className="relative overflow-hidden border-b border-border px-6 py-5">
                {/* ambient glow */}
                <div className="absolute -top-6 -right-6 size-24 rounded-full bg-primary/15 blur-2xl" />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-2xl bg-primary shadow-sm">
                      <Zap className="size-4 fill-primary-foreground text-primary-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground/90">Publish Settings</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px] truncate">
                        {pollTitle || "Your Poll"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    disabled={isLoading}
                    className="flex size-8 items-center justify-center rounded-xl text-muted-foreground/50 hover:bg-secondary hover:text-foreground transition-all disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-5">

                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    <CalendarClock className="size-3" />
                    Poll Closes At
                  </label>
                  <DateTimePicker
                    value={expiresAtLocal}
                    onChange={onExpiresChange}
                    disabled={isLoading}
                  />
                </div>

                {/* Toggle settings */}
                <div className="space-y-0 rounded-2xl border border-border bg-secondary/10 overflow-hidden">
                  {/* Anonymous */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-xl bg-secondary/50">
                        <UserRound className="size-3.5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground/80">Anonymous Responses</p>
                        <p className="text-[10px] text-muted-foreground">No voter identity stored</p>
                      </div>
                    </div>
                    <Switch
                      checked={isAnonymous}
                      onCheckedChange={onAnonymousChange}
                      className="shrink-0 scale-90"
                    />
                  </div>

                  <div className="h-px bg-border mx-4" />

                  {/* Published */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-xl bg-secondary/50">
                        <Eye className="size-3.5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground/80">Publish Immediately</p>
                        <p className="text-[10px] text-muted-foreground">
                          {isPublished ? "Poll goes live on publish" : "Saved as draft"}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={isPublished}
                      onCheckedChange={onPublishedChange}
                      className="shrink-0 scale-90"
                    />
                  </div>

                  <div className="h-px bg-border mx-4" />

                  {/* Privacy info row */}
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="flex size-8 items-center justify-center rounded-xl bg-secondary/50">
                      <Shield className="size-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground/80">Response Visibility</p>
                      <p className="text-[10px] text-muted-foreground">
                        {isAnonymous ? "Responses are fully anonymous" : "Creator can see device IDs"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Summary pill */}
                <div className={cn(
                  "rounded-xl px-4 py-2.5 text-[11px] font-medium flex items-center gap-2 transition-all duration-300",
                  isPublished
                    ? "bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-500"
                    : "bg-secondary/30 border border-border text-muted-foreground"
                )}>
                  <div className={cn("size-1.5 rounded-full shrink-0", isPublished ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/20")} />
                  {isPublished
                    ? "Poll will go live immediately after publishing"
                    : "Poll will be saved as a private draft"}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 border-t border-border px-6 py-4">
                <button
                  onClick={onClose}
                  disabled={isLoading}
                  className="flex-1 rounded-xl border border-border bg-secondary/30 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-all disabled:opacity-30"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isLoading}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all duration-200 active:scale-[0.98]",
                    isLoading
                      ? "bg-primary/30 text-primary/50 cursor-not-allowed"
                      : "bg-primary text-primary-foreground shadow-sm hover:opacity-90"
                  )}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Publishing…
                    </>
                  ) : (
                    <>
                      <Send className="size-4" />
                      {isPublished ? "Publish Poll" : "Save as Draft"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
