"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A value to paste somewhere else (IdP settings, DNS): label, monospace text, copy button. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-secondary/60 px-2.5 py-1.5 font-mono text-xs text-foreground" title={value}>
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
