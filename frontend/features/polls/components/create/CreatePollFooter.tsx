"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type CreatePollFooterProps = {
  canSave: boolean;
  isLoading: boolean;
  onCancel: () => void;
  onSave: () => void;
};

export function CreatePollFooter({ canSave, isLoading, onCancel, onSave }: CreatePollFooterProps) {
  return (
    <footer className="sticky bottom-0 z-10 -mx-4 mt-10 border-t border-border bg-background/80 px-4 py-4 backdrop-blur-2xl supports-backdrop-filter:bg-background/60 md:-mx-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {canSave ? "Ready to save when you are." : "Fill title, a future close time, and at least two choices per question."}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" className="rounded-full px-6" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="button"
            className="group h-auto py-2 pl-6 pr-2 rounded-full border border-primary bg-primary font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60 active:scale-[0.98] transition-all duration-300 hover:shadow-[0_0_20px_rgba(216,173,135,0.4)]"
            disabled={!canSave || isLoading}
            onClick={onSave}
          >
            <span className="mr-2">{isLoading ? "Saving…" : "Save poll"}</span>
            <div className="flex size-8 items-center justify-center rounded-full bg-primary-foreground/10 transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-[1px]">
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <div className="size-2 rounded-full bg-primary-foreground/60" />}
            </div>
          </Button>
        </div>
      </div>
    </footer>
  );
}
