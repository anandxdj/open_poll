"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, FileText, Loader2, Lock, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { downloadExport, readBlobError } from "../api/sessions";
import { exportFileFallback, exportOptions } from "../query";
import type { ExportFormat, SessionReport } from "../types";

const ICONS = { csv: Table2, xlsx: FileSpreadsheet, pdf: FileText } as const;
const PLAN_NAMES: Record<string, string> = { free: "Free", pro: "Pro", team: "Team", enterprise: "Enterprise" };

/**
 * Export buttons with plan gating: formats in the plan download straight
 * away; the others are marked with a lock and open a clear upgrade message
 * instead of failing. The server enforces the same rule (403
 * FEATURE_NOT_IN_PLAN), which is handled too (a plan that changed meanwhile).
 */
export function ExportMenu({ report }: { report: SessionReport }) {
  const t = useTranslations("sessions.report.export");
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [locked, setLocked] = useState<ExportFormat | null>(null);
  const options = exportOptions(report);
  const plan = PLAN_NAMES[report.exports.plan] ?? report.exports.plan;
  const formatLabel = (format: ExportFormat) => t(format);

  async function run(format: ExportFormat) {
    setBusy(format);
    try {
      const { session } = report;
      await downloadExport(session.sessionId, format, exportFileFallback(session.title, session.runNumber, format));
      toast.success(t("done", { format: formatLabel(format) }));
    } catch (err: unknown) {
      const body = await readBlobError(err);
      if (body?.code === "FEATURE_NOT_IN_PLAN") setLocked(format);
      else toast.error(body?.message ?? getApiErrorMessage(err) ?? t("failed", { format: formatLabel(format) }));
    } finally {
      setBusy(null);
    }
  }

  if (!report.access.export) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-xl font-bold" disabled={busy !== null}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            {busy ? t("preparing") : t("button")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 rounded-2xl p-1">
          {options.map((option) => {
            const Icon = ICONS[option.format];
            return (
              <DropdownMenuItem
                key={option.format}
                className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5"
                onSelect={() => (option.included ? void run(option.format) : setLocked(option.format))}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", !option.included && "text-muted-foreground/50")} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    {formatLabel(option.format)}
                    {!option.included ? <Lock className="size-3 text-muted-foreground" aria-label={t("lockedTitle", { format: formatLabel(option.format), plan })} /> : null}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">{t(`${option.format}Hint`)}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={locked !== null} onOpenChange={(open) => !open && setLocked(null)}>
        <DialogContent className="rounded-3xl">
          {locked ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-bold">
                  {t("lockedTitle", { format: formatLabel(locked), plan })}
                </DialogTitle>
                <DialogDescription>{t("lockedHint", { format: formatLabel(locked) })}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button asChild className="rounded-xl font-bold">
                  <Link href="/settings/workspace">{t("seePlan")}</Link>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
