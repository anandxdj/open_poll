"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Something to paste elsewhere (an iframe, a URL): a label, the value in a
 * read-only field that selects itself on focus, and a copy button.
 */
export function CopyField({ label, value, multiline = false, hint }: { label: string; value: string; multiline?: boolean; hint?: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.");
    }
  };
  const field = "w-full min-w-0 rounded-md border border-border bg-secondary/60 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className={cn("flex gap-2", multiline ? "items-start" : "items-center")}>
        {multiline ? (
          <textarea id={id} readOnly value={value} rows={3} className={cn(field, "resize-none leading-relaxed")} onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input id={id} readOnly value={value} className={field} onFocus={(e) => e.currentTarget.select()} />
        )}
        <Button type="button" variant="outline" size="sm" className="shrink-0 bg-card" onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check className="text-success" /> : <Copy />}
          <span className="hidden sm:inline">Copy</span>
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
