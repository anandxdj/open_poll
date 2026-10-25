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
    <div className="max-w-xl w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 my-auto">
      <div className="space-y-2">
        <p className="text-xs font-mono font-bold uppercase tracking-widest text-deck-stage-fg/50 flex items-center justify-center gap-1.5 flex-wrap">
          <span>{t("scanOrJoin")}</span>
          <button
            type="button"
            onClick={copyUrl}
            title={t("copyLink")}
            className="inline-flex items-center gap-1.5 text-deck-primary font-extrabold underline font-mono hover:text-deck-primary/80 transition-all cursor-pointer group focus:outline-none focus:ring-2 focus:ring-deck-primary/50 rounded px-2 py-0.5 bg-deck-primary/10 hover:bg-deck-primary/20 border border-deck-primary/30"
          >
            <span>{playUrl ? playUrl.replace(/^https?:\/\//, "").toUpperCase() : ""}</span>
            {copiedUrl ? (
              <Check className="size-3.5 text-deck-correct-soft shrink-0" />
            ) : (
              <Copy className="size-3.5 text-deck-primary/70 group-hover:text-deck-primary shrink-0 transition-colors" />
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
          className="rounded-[2.5rem] border border-deck-stage-fg/15 bg-deck-stage-fg/5 hover:bg-deck-stage-fg/10 hover:border-deck-primary/40 transition-all px-10 py-8 text-center shadow-2xl flex flex-col items-center justify-center min-w-[280px] min-h-[200px] backdrop-blur-xl group cursor-pointer focus:outline-none focus:ring-2 focus:ring-deck-primary/50"
        >
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-deck-primary/80 mb-2 flex items-center gap-1.5">
            {t("joinCode")}
            {copiedCode ? (
              <Check className="size-3 text-deck-correct-soft" />
            ) : (
              <Copy className="size-3 opacity-60 group-hover:opacity-100 text-deck-primary transition-opacity" />
            )}
          </span>
          <span className="text-5xl font-extrabold tracking-[0.2em] font-mono text-deck-primary drop-shadow-md group-hover:scale-105 transition-transform">
            {joinCode}
          </span>
          <span className="text-[10px] text-deck-stage-fg/40 mt-2 transition-opacity">
            {copiedCode ? t("copiedCode") : t("clickToCopy")}
          </span>
        </button>

        {playUrl && (
          <div className="p-5 bg-deck-qr-bg rounded-[2.5rem] shadow-2xl flex items-center justify-center min-h-[200px] min-w-[200px]">
            <QRCodeSVG value={playUrl} size={160} aria-label={t("qrLabel", { url: playUrl })} />
          </div>
        )}
      </div>

      {/* Joined count & chips */}
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-deck-stage-fg/50">
          <Users className="size-4 text-deck-primary" /> {t("joined", { count: participants.length })}
        </div>
        {participants.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2 max-h-36 overflow-y-auto p-2">
            {participants.map((p) => (
              <span
                key={p.participantId}
                className="rounded-full bg-deck-stage-fg/10 border border-deck-stage-fg/15 px-4 py-1.5 text-xs font-semibold text-deck-stage-fg/90 shadow-sm"
              >
                {p.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-deck-stage-fg/30 italic">{t("waiting")}</p>
        )}
      </div>

      {actions && <div className="pt-2">{actions}</div>}
    </div>
  );
}
