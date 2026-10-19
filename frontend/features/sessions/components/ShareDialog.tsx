"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, RefreshCw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage } from "@/lib/api-error";
import { disableShare, enableShare } from "../api/sessions";
import { defaultExpiryChoice, expiryFor, formatDateTime, SHARE_EXPIRY_CHOICES, shareUrl, type ShareExpiryKey } from "../query";
import type { SessionShare, ShareInput } from "../types";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  /** The session has ended (a running session cannot be shared). */
  ended: boolean;
  share: SessionShare | null;
  onChange: (share: SessionShare | null) => void;
}

const KEEP = "keep" as const;
type ExpiryChoice = ShareExpiryKey | typeof KEEP;

/**
 * Public results link: create it, copy it, choose whether names appear and
 * when it expires, turn it off, or replace it with a new one.
 */
export function ShareDialog({ open, onOpenChange, sessionId, ended, share, onChange }: ShareDialogProps) {
  const t = useTranslations("sessions.shareDialog");
  const [busy, setBusy] = useState<"save" | "disable" | "rotate" | null>(null);
  const [includeNames, setIncludeNames] = useState(share?.includeNames ?? false);
  // A lapsed expiry cannot be kept: start from a fresh one, visibly.
  const [expiry, setExpiry] = useState<ExpiryChoice>(() => defaultExpiryChoice(share));
  const [copied, setCopied] = useState(false);

  const active = share?.active === true;
  const url = share?.token ? shareUrl(window.location.origin, share.token) : null;
  const lapsed = share?.enabled === true && !active;

  async function save(input: ShareInput, mode: "save" | "rotate", successKey: "enabledToast" | "updatedToast") {
    setBusy(mode);
    try {
      const next = await enableShare(sessionId, input);
      onChange(next);
      setIncludeNames(next.includeNames);
      setExpiry(KEEP);
      toast.success(t(successKey));
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? t("failed"));
    } finally {
      setBusy(null);
    }
  }

  const expiryInput = (): Pick<ShareInput, "expiresAt"> =>
    expiry === KEEP ? {} : { expiresAt: expiryFor(expiry) };

  async function turnOff() {
    setBusy("disable");
    try {
      const next = await disableShare(sessionId);
      onChange(next);
      toast.success(t("disabledToast"));
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? t("failed"));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  const expiryLabels: Record<ShareExpiryKey, string> = {
    never: t("expiryNever"),
    "1d": t("expiry1d"),
    "7d": t("expiry7d"),
    "30d": t("expiry30d"),
  };
  const dirty =
    share !== null && (includeNames !== share.includeNames || expiry !== KEEP || !share.active);

  return (
    <Dialog open={open} onOpenChange={(next) => busy === null && onOpenChange(next)}>
      <DialogContent className="rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Link2 className="size-4" /> {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {!ended ? (
          <p role="status" className="rounded-2xl border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            {t("needsEnd")}
          </p>
        ) : (
          <div className="space-y-5">
            {url ? (
              <div className="space-y-2">
                <Label htmlFor="share-link">{t("linkLabel")}</Label>
                <div className="flex gap-2">
                  <Input id="share-link" readOnly value={url} className="rounded-xl font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" className="rounded-xl" onClick={() => void copy()} disabled={!active}>
                    {copied ? <Check /> : <Copy />}
                    <span className="sr-only sm:not-sr-only">{t("copy")}</span>
                  </Button>
                  {active ? (
                    <Button asChild variant="outline" className="rounded-xl" size="icon">
                      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("open")}>
                        <ExternalLink />
                      </a>
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground" role="status">
                  {lapsed
                    ? t("expired")
                    : !share?.enabled
                      ? t("inactive")
                      : share.expiresAt
                        ? t("expiresOn", { date: formatDateTime(share.expiresAt) })
                        : t("neverExpires")}
                </p>
              </div>
            ) : null}

            <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="share-names" className="text-sm font-semibold">
                  {t("includeNames")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("includeNamesHint")}</p>
              </div>
              <Switch id="share-names" checked={includeNames} onCheckedChange={setIncludeNames} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="share-expiry">{t("expiry")}</Label>
              <select
                id="share-expiry"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value as ExpiryChoice)}
                className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {share ? <option value={KEEP}>{t("expiryKeep")}</option> : null}
                {SHARE_EXPIRY_CHOICES.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {expiryLabels[choice.key]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {ended ? (
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {share ? (
                <>
                  {active ? (
                    <Button variant="outline" className="rounded-xl" disabled={busy !== null} onClick={() => void turnOff()}>
                      {busy === "disable" ? <Loader2 className="animate-spin" /> : null}
                      {busy === "disable" ? t("disabling") : t("disable")}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="rounded-xl"
                    title={t("rotateHint")}
                    disabled={busy !== null}
                    onClick={() => void save({ ...expiryInput(), includeNames, rotate: true }, "rotate", "updatedToast")}
                  >
                    {busy === "rotate" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {t("rotate")}
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex gap-2">
              {!share ? (
                <Button
                  className="rounded-xl font-bold"
                  disabled={busy !== null}
                  onClick={() => void save({ ...expiryInput(), includeNames }, "save", "enabledToast")}
                >
                  {busy === "save" ? <Loader2 className="animate-spin" /> : null}
                  {busy === "save" ? t("enabling") : t("enable")}
                </Button>
              ) : dirty ? (
                <Button
                  className="rounded-xl font-bold"
                  disabled={busy !== null}
                  onClick={() => void save({ ...expiryInput(), includeNames }, "save", "updatedToast")}
                >
                  {busy === "save" ? <Loader2 className="animate-spin" /> : null}
                  {!share.enabled || lapsed ? t("reenable") : t("update")}
                </Button>
              ) : (
                <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
                  {t("done")}
                </Button>
              )}
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
