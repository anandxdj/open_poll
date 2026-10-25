"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, BarChart2, CalendarClock, Eye, Loader2, Send, Shield, Target, UserRound, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import type { QuestionForm } from "./types";

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
  pollType?: 'POLL' | 'TRIAL';
  onPollTypeChange?: (v: 'POLL' | 'TRIAL') => void;
  passingScorePercentage?: number;
  onPassingScorePercentageChange?: (v: number) => void;
  questions?: QuestionForm[];
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
  pollType = 'POLL',
  onPollTypeChange,
  passingScorePercentage = 70,
  onPassingScorePercentageChange,
  questions = [],
}: PublishSettingsModalProps) {
  const isTrial = pollType === 'TRIAL';
  const missingAnswerIndices = (questions || [])
    .map((q, idx) => (!q.correctOptionIndices || q.correctOptionIndices.length === 0 ? idx + 1 : null))
    .filter((v): v is number => v !== null);
  const hasMissingAnswers = isTrial && missingAnswerIndices.length > 0;

  async function handleConfirm() {
    if (hasMissingAnswers) return;
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
            <div className="pointer-events-auto w-full max-w-md rounded-xl border border-border bg-popover shadow-xl shadow-black/15 overflow-hidden">

              {/* Header */}
              <div className="relative overflow-hidden border-b border-border px-6 py-5">
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-lg font-semibold tracking-[-0.02em] text-foreground">Publish settings</p>
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">
                        {pollTitle || "Your Poll"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    disabled={isLoading}
                    className="flex size-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-5">

                {/* Mode Selector (Poll vs Quiz) */}
                {onPollTypeChange && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Publish Mode
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-1 rounded-lg border border-border bg-secondary/20">
                      <button
                        type="button"
                        onClick={() => onPollTypeChange('POLL')}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all",
                          pollType === 'POLL'
                            ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <BarChart2 className="size-4" />
                        <span>Poll (Survey)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onPollTypeChange('TRIAL')}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all",
                          pollType === 'TRIAL'
                            ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Target className="size-4" />
                        <span>Quiz (Trial)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Passing Score Input for Quiz Mode */}
                {isTrial && onPassingScorePercentageChange && (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/50 p-3.5">
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-foreground">Passing grade</p>
                      <p className="text-xs text-muted-foreground">Score needed to pass assessment</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={10}
                        max={100}
                        step={5}
                        value={passingScorePercentage}
                        onChange={(e) => onPassingScorePercentageChange(Number(e.target.value))}
                        className="w-14 rounded-xl border border-input bg-card px-2 py-1 text-center text-xs font-semibold text-foreground focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-foreground">%</span>
                    </div>
                  </div>
                )}

                {/* Warning Banner for Missing Quiz Answers */}
                {hasMissingAnswers && (
                  <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3.5 text-warning">
                    <AlertTriangle className="size-5 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-xs">
                      <p className="font-semibold">Missing Quiz Answers</p>
                      <p className="text-xs text-foreground leading-snug">
                        Question{missingAnswerIndices.length > 1 ? "s" : ""} {missingAnswerIndices.join(", ")} {missingAnswerIndices.length > 1 ? "need" : "needs"} at least one correct answer marked before publishing as a Quiz.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <CalendarClock className="size-3" />
                    {isTrial ? "Quiz Closes At" : "Poll Closes At"}
                  </label>
                  <DateTimePicker
                    value={expiresAtLocal}
                    onChange={onExpiresChange}
                    disabled={isLoading}
                  />
                </div>

                {/* Toggle settings */}
                <div className="space-y-0 rounded-lg border border-border bg-secondary/10 overflow-hidden">
                  {/* Anonymous */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-xl bg-secondary/50">
                        <UserRound className="size-3.5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Anonymous responses</p>
                        <p className="text-xs text-muted-foreground">No voter identity stored</p>
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
                        <p className="text-sm font-medium text-foreground">Publish immediately</p>
                        <p className="text-xs text-muted-foreground">
                          {isPublished ? (isTrial ? "Quiz goes live on publish" : "Poll goes live on publish") : "Saved as draft"}
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
                      <p className="text-sm font-medium text-foreground">Response visibility</p>
                      <p className="text-xs text-muted-foreground">
                        {isAnonymous ? "Responses are fully anonymous" : "Creator can see device IDs"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Summary pill */}
                <div className={cn(
                  "rounded-xl px-4 py-2.5 text-xs font-medium flex items-center gap-2 transition-all duration-300",
                  isPublished
                    ? "bg-success/10 border border-success/25 text-success"
                    : "bg-secondary/30 border border-border text-muted-foreground"
                )}>
                  <div className={cn("size-1.5 rounded-full shrink-0", isPublished ? "bg-success animate-pulse" : "bg-faint")} />
                  {isPublished
                    ? (isTrial ? "Quiz will go live immediately after publishing" : "Poll will go live immediately after publishing")
                    : (isTrial ? "Quiz will be saved as a private draft" : "Poll will be saved as a private draft")}
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
                  disabled={isLoading || hasMissingAnswers}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98]",
                    isLoading || hasMissingAnswers
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
                      {isPublished ? (isTrial ? "Publish Quiz" : "Publish Poll") : "Save as Draft"}
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
