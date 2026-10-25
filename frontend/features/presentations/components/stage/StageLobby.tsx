"use client";

import type { ReactNode } from "react";
import { Check, Copy, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";

export interface JoinLinkControls {
  /** Absolute participant URL (`/live/<code>`); empty until known. */
  playUrl: string;
  copiedUrl: boolean;
  copiedCode: boolean;
  copyUrl: () => void;
  copyCode: () => void;
}

/** Join instructions: URL, big code, QR, who joined — plus the host's start control. */
export function StageLobby({ join, actions }: { join: JoinLinkControls; actions?: ReactNode }) {
  const t = useTranslations("presenter.lobby");
  const joinCode = useLive((s) => s.joinCode);
  const participants = useLive((s) => s.participants);
  const { playUrl, copiedUrl, copiedCode, copyUrl, copyCode } = join;

  return (
    <div className="relative my-auto w-full max-w-2xl space-y-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-2">
        <p className="flex flex-wrap items-center justify-center gap-2 text-base text-deck-stage-fg/70 sm:text-lg">
          <span>{t("scanOrJoin")}</span>
          <button
            type="button"
            onClick={copyUrl}
            title={t("copyLink")}
            className="group inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono font-medium text-deck-stage-fg underline decoration-deck-accent decoration-2 underline-offset-4 transition-colors hover:bg-deck-stage-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50"
          >
            <span>{playUrl ? playUrl.replace(/^https?:\/\//, "") : ""}</span>
            {copiedUrl ? (
              <Check className="size-3.5 text-deck-correct-soft shrink-0" />
            ) : (
              <Copy className="size-3.5 shrink-0 text-deck-stage-fg/50 transition-colors group-hover:text-deck-stage-fg" />
            )}
          </button>
          <span>{t("withCode")}</span>
        </p>
      </div>

      {/* Large join code & QR code */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
        <button
          type="button"
          onClick={copyCode}
          title={t("copyCode")}
          className="group flex min-h-[200px] min-w-[300px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-deck-stage-fg/15 bg-deck-stage-panel px-10 py-8 text-center shadow-[0_32px_64px_-24px_rgb(0_0_0/0.6)] transition-colors hover:border-deck-stage-fg/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50"
        >
          <span className="mb-3 flex items-center gap-1.5 text-sm font-medium text-deck-stage-fg/60">
            {t("joinCode")}
            {copiedCode ? (
              <Check className="size-3 text-deck-correct-soft" />
            ) : (
              <Copy className="size-3.5 opacity-60 transition-opacity group-hover:opacity-100" />
            )}
          </span>
          <span className="font-mono text-6xl font-semibold tracking-[0.12em] text-deck-accent tabular-nums">
            {joinCode}
          </span>
          <span className="mt-3 text-sm text-deck-stage-fg/50">
            {copiedCode ? t("copiedCode") : t("clickToCopy")}
          </span>
        </button>

        {playUrl && (
          <div className="flex min-h-[200px] min-w-[200px] items-center justify-center rounded-2xl bg-deck-qr-bg p-5 shadow-[0_32px_64px_-24px_rgb(0_0_0/0.6)]">
            <QRCodeSVG value={playUrl} size={160} aria-label={t("qrLabel", { url: playUrl })} />
          </div>
        )}
      </div>

      {/* Joined count & chips */}
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2 text-base font-medium text-deck-stage-fg/80">
          <Users className="size-5 text-deck-accent" /> {t("joined", { count: participants.length })}
        </div>
        {participants.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2 max-h-36 overflow-y-auto p-2">
            {participants.map((p) => (
              <span
                key={p.participantId}
                className="rounded-full border border-deck-stage-fg/15 bg-deck-stage-fg/5 px-3.5 py-1.5 text-sm font-medium text-deck-stage-fg animate-in fade-in zoom-in-95 duration-300"
              >
                {p.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-deck-stage-fg/50">{t("waiting")}</p>
        )}
      </div>

      {actions && <div className="pt-2">{actions}</div>}
    </div>
  );
}
