"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getApiErrorMessage } from "@/lib/api-error";
import { deleteSession } from "../api/sessions";

interface DeleteSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  runNumber: number;
  onDeleted: () => void;
}

/** Confirms, then deletes the session with its participants and answers. */
export function DeleteSessionDialog({ open, onOpenChange, sessionId, runNumber, onDeleted }: DeleteSessionDialogProps) {
  const t = useTranslations("sessions.report.delete");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await deleteSession(sessionId);
      toast.success(t("done"));
      onDeleted();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? t("failed"));
      setBusy(false);
      onOpenChange(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-semibold">{t("title", { number: runNumber })}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">{t("body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 gap-3">
          <AlertDialogCancel>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
            className="bg-destructive text-white transition-colors hover:bg-destructive/90"
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
