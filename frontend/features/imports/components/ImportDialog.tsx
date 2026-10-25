"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FilePanel } from "./FilePanel";
import { GooglePanel } from "./GooglePanel";
import { QuestionsPanel } from "./QuestionsPanel";

const TABS = ["file", "google", "questions"] as const;
type Tab = (typeof TABS)[number];

/** The library's Import dialog: a presentation file, a Google Slides link, or a questions spreadsheet. */
export function ImportDialog({
  open,
  onOpenChange,
  initialTab = "file",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: Tab;
}) {
  const t = useTranslations("imports");
  const [tab, setTab] = useState<Tab>(initialTab);
  const baseId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{t("dialog.title")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label={t("dialog.tabsLabel")} className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${baseId}-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const next = TABS[(TABS.indexOf(id) + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
                setTab(next);
                document.getElementById(`${baseId}-tab-${next}`)?.focus();
              }}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                tab === id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${baseId}-panel-${tab}`} aria-labelledby={`${baseId}-tab-${tab}`}>
          {tab === "file" ? <FilePanel /> : null}
          {tab === "google" ? <GooglePanel /> : null}
          {tab === "questions" ? <QuestionsPanel target={{ kind: "newDeck" }} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
