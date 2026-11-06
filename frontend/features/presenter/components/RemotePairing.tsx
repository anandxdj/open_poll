"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api-error";
import { createRemoteToken, getRemoteStatus, revokeRemoteToken } from "@/features/presentations/api/host";
import { useLive, useLiveStore } from "@/features/presentations/live/store";
import type { RemoteStatus } from "@/features/presentations/types";
import { REMOTE_PREFIX, type RemotePresence } from "../remoteState";

const pill =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-deck-stage-fg/15 px-3.5 text-sm font-medium text-deck-stage-fg transition-colors hover:bg-deck-stage-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50 disabled:opacity-50";

/**
 * Pairs a phone as a remote (W2-A). "Pair a phone" makes a new one-time token
 * (any previous pairing is revoked) and shows it as a QR code; the first phone
 * that opens it binds it. The token is only ever shown here, once: after a
 * reload the panel shows the pairing's status and offers a new code. Whether
 * the phone is connected comes from `remote:connected` / `remote:disconnected`.
 */
export function RemotePairing({ presentationId }: { presentationId: string }) {
  const t = useTranslations("presenter.remote");
  const store = useLiveStore();
  const presence = useLive((s) => s.modules[REMOTE_PREFIX] as RemotePresence | undefined);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  const applyStatus = useCallback(
    (next: RemoteStatus) => {
      setStatus(next);
      store
        .getState()
        .dispatch({ type: "live/module", prefix: REMOTE_PREFIX, name: "status", payload: { connected: next.connected, bound: next.bound } });
    },
    [store]
  );

  useEffect(() => {
    let cancelled = false;
    getRemoteStatus(presentationId)
      .then((next) => {
        if (!cancelled) applyStatus(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [presentationId, applyStatus]);

  const pair = async () => {
    setWorking(true);
    try {
      const created = await createRemoteToken(presentationId);
      setUrl(`${window.location.origin}${created.path}`);
      applyStatus({ paired: true, bound: false, boundAt: null, expiresAt: created.expiresAt, connected: false });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || t("pair"));
    } finally {
      setWorking(false);
    }
  };

  const unpair = async () => {
    setWorking(true);
    try {
      applyStatus(await revokeRemoteToken(presentationId));
      setUrl(null);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || t("unpair"));
    } finally {
      setWorking(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is on screen to copy by hand.
    }
  };

  const connected = presence?.connected ?? status?.connected ?? false;
  const paired = status?.paired ?? false;
  const bound = presence?.bound ?? status?.bound ?? false;
  const label = !paired
    ? t("statusNone")
    : connected
      ? t("statusConnected")
      : bound
        ? t("statusOffline")
        : t("statusWaiting");

  return (
    <section aria-labelledby="presenter-remote-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="presenter-remote-title" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-deck-stage-muted">
          <Smartphone className="size-3.5" aria-hidden="true" /> {t("title")}
        </h2>
        <span role="status" data-testid="remote-status" className="flex items-center gap-1.5 text-xs text-deck-stage-fg/70">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${connected ? "bg-deck-live" : paired ? "bg-deck-stage-fg/40" : "bg-deck-stage-fg/20"}`}
          />
          {label}
        </span>
      </div>

      {url && !connected ? (
        <div className="space-y-2">
          <div className="mx-auto w-fit rounded-lg bg-deck-qr-bg p-2.5">
            <QRCodeSVG value={url} size={148} level="M" aria-label={t("qrLabel")} role="img" />
          </div>
          <p className="break-all text-center font-mono text-[11px] text-deck-stage-muted" data-testid="remote-link">{url}</p>
          <p className="text-xs text-deck-stage-muted">{t("oneDevice")}</p>
        </div>
      ) : connected ? null : (
        <p className="text-sm text-deck-stage-muted">{paired && !url ? t("codeHidden") : t("hint")}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void pair()} disabled={working} className={pill}>
          <Smartphone className="size-4" aria-hidden="true" /> {paired ? t("repair") : t("pair")}
        </button>
        {url && !connected && (
          <button type="button" onClick={() => void copy()} className={pill}>
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? t("copied") : t("copyLink")}
          </button>
        )}
        {paired && (
          <button type="button" onClick={() => void unpair()} disabled={working} className={pill}>
            {t("unpair")}
          </button>
        )}
      </div>
    </section>
  );
}
