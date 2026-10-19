"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";

import { ImportIntlProvider } from "../ImportIntlProvider";
import { ImportDialog } from "./ImportDialog";

function ImportButtonInner() {
  const t = useTranslations("imports");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 transition-colors duration-200 hover:border-primary/30 hover:text-primary"
      >
        <Upload className="size-3.5" aria-hidden />
        {t("button")}
      </button>
      {/* Remounted on open so a finished import never greets the next one. */}
      {open ? <ImportDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

/** Library entry point: the "Import" button and its dialog, with its own message scope. */
export function ImportButton() {
  return (
    <ImportIntlProvider>
      <ImportButtonInner />
    </ImportIntlProvider>
  );
}
