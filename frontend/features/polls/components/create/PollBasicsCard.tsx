"use client";

import { CalendarClock, ChevronDown, ChevronUp, Eye, Settings2, UserRound } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { DateTimePicker } from "@/components/ui/date-time-picker";

type PollSettingsPanelProps = {
  title: string;
  onTitleChange: (value: string) => void;
  expiresAtLocal: string;
  onExpiresChange: (value: string) => void;
  isAnonymous: boolean;
  onAnonymousChange: (value: boolean) => void;
  isPublished: boolean;
  onPublishedChange: (value: boolean) => void;
};

export function PollSettingsPanel({
  title,
  onTitleChange,
  expiresAtLocal,
  onExpiresChange,
  isAnonymous,
  onAnonymousChange,
  isPublished,
  onPublishedChange,
}: PollSettingsPanelProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors duration-200 hover:bg-secondary/30"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-widest text-foreground/75">
            Poll Settings
          </span>
        </div>
        {open ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-4 pb-4">
          {/* Title */}
          <div className="space-y-1.5 pt-4">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Poll Title
            </label>
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Give your poll a name…"
              className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2.5 text-sm font-medium text-foreground placeholder:text-muted-foreground transition-all duration-300 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary focus:bg-primary/5 focus:shadow-[0_0_15px_rgba(216,173,135,0.15)]"
            />
          </div>

          {/* Expires */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <CalendarClock className="size-3" />
              Closes at
            </label>
            <DateTimePicker
              value={expiresAtLocal}
              onChange={onExpiresChange}
            />
          </div>

          {/* Toggles */}
          <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground/85">Anonymous</p>
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    No identifiers stored
                  </p>
                </div>
              </div>
              <Switch
                checked={isAnonymous}
                onCheckedChange={onAnonymousChange}
                className="shrink-0 scale-90"
              />
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground/85">Published</p>
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    Visible to respondents
                  </p>
                </div>
              </div>
              <Switch
                checked={isPublished}
                onCheckedChange={onPublishedChange}
                className="shrink-0 scale-90"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
