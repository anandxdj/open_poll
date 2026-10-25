"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ImportIntlProvider } from "../ImportIntlProvider";
import { ImportDialog } from "./ImportDialog";

function ImportButtonInner({ className }: { className?: string }) {
  const t = useTranslations("imports");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: "outline" }), "bg-card", className)}
      >
        <Upload aria-hidden />
        {t("button")}
      </button>
      {/* Remounted on open so a finished import never greets the next one. */}
      {open ? <ImportDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

/** Library entry point: the "Import" button and its dialog, with its own message scope. */
export function ImportButton({ className }: { className?: string }) {
  return (
    <ImportIntlProvider>
      <ImportButtonInner className={className} />
    </ImportIntlProvider>
  );
}
