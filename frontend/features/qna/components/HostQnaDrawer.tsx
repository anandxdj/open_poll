"use client";

import { useEffect, useId, useState } from "react";
import { MessageCircleQuestion, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { useLive } from "@/features/presentations/live/store";
import { cn } from "@/lib/utils";
import { questionsWithStatus } from "../state";
import { selectQna, useQnaSync } from "../useQnaSync";
import { HostQnaPanel } from "./HostQnaPanel";

/**
 * Host header button with the number of questions waiting for approval, and
 * the moderation panel as a side drawer. Also keeps the Q&A slice loaded for
 * the stage overlays and the Q&A board.
 */
export function HostQnaDrawer() {
  const t = useTranslations("qna");
  useQnaSync();
  const pending = useLive((s) => questionsWithStatus(selectQna(s), "pending").length);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? t("host.close") : t("host.open")}
        title={pending > 0 ? t("host.pendingBadge", { count: pending }) : t("tab")}
        className={cn(
          "relative inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors",
          open
            ? "border-deck-primary bg-deck-primary text-deck-primary-fg"
            : "border-deck-stage-fg/15 bg-deck-stage-fg/5 text-deck-stage-fg/80 hover:bg-deck-stage-fg/10"
        )}
      >
        <MessageCircleQuestion className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">{t("tab")}</span>
        {pending > 0 && (
          <span
            aria-hidden
            className="min-w-4 rounded-full bg-deck-accent px-1 text-center text-[10px] leading-4 text-deck-stage-ink tabular-nums"
          >
            {pending}
          </span>
        )}
      </button>

      {open && (
        <aside
          id={panelId}
          aria-label={t("host.title")}
          // Keys typed in the panel (sort menu, buttons) must not reach the console's slide shortcuts.
          onKeyDown={(e) => {
            if (e.key !== "Escape") e.stopPropagation();
          }}
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[26rem] flex-col gap-3 border-l border-deck-stage-fg/10 bg-deck-stage-chrome p-4 pt-5 text-deck-stage-fg shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">{t("host.title")}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("host.close")}
              className="rounded-full p-1.5 text-deck-stage-fg/60 hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <HostQnaPanel className="flex-1" />
        </aside>
      )}
    </>
  );
}
