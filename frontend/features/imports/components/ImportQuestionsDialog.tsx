"use client";

import { useTranslations } from "next-intl";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImportIntlProvider } from "../ImportIntlProvider";
import { QuestionsPanel } from "./QuestionsPanel";
import type { QuestionsResult } from "../types";

function Inner({
  open,
  onOpenChange,
  room,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: number;
  onAdd: (slides: NonNullable<QuestionsResult["slides"]>) => void;
}) {
  const t = useTranslations("imports");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{t("builder.title")}</DialogTitle>
          <DialogDescription>{t("builder.description")}</DialogDescription>
        </DialogHeader>
        {open ? <QuestionsPanel target={{ kind: "localDeck", room, onAdd }} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The builder's "Import questions": checks a CSV/XLSX on the server and hands the parsed slides to the builder,
 * which adds them to the deck it has open. `room` is how many more slides the deck holds.
 */
export function ImportQuestionsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: number;
  onAdd: (slides: NonNullable<QuestionsResult["slides"]>) => void;
}) {
  return (
    <ImportIntlProvider>
      <Inner {...props} />
    </ImportIntlProvider>
  );
}
