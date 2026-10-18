"use client";

import { useSyncExternalStore } from "react";
import { QrCode } from "lucide-react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";

import { useLiveOptional } from "../../../live/store";
import { ContentStage } from "../../content/ContentViews";
import { readInstructions } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";

const subscribeNever = () => () => {};

/** This site's origin in the browser; "" while rendering on the server. */
export const useOrigin = () =>
  useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => ""
  );

/** "Go to <site>/live and enter the code", the QR code and the extra text; the code comes from the session. */
export function InstructionsStage({ slide, mode }: StageViewProps) {
  const t = useTranslations("live.slides.instructions");
  const { showQr, showCode, text } = readInstructions(slide.content);
  const joinCode = useLiveOptional((s) => s.joinCode);
  const origin = useOrigin();
  const live = mode !== "thumbnail" && joinCode !== "";
  const joinUrl = live && origin ? `${origin}/live/${joinCode}` : "";
  const address = `${origin.replace(/^https?:\/\//, "")}/live`;

  return (
    <ContentStage mode={mode} className="flex flex-col items-center gap-[4cqw] py-[2cqw] text-center">
      {(showCode || showQr) && (
        <div className="flex w-full flex-wrap items-center justify-center gap-[6cqw]">
          {showCode && (
            <div className="space-y-[1.2cqw]">
              <p className="text-[clamp(1rem,2.8cqw,1.75rem)] font-semibold text-deck-stage-fg/60">{t("goTo")}</p>
              <p className="font-mono text-[clamp(1.25rem,4.2cqw,2.6rem)] font-extrabold text-deck-stage-fg">{address}</p>
              <p className="text-[clamp(1rem,2.8cqw,1.75rem)] font-semibold text-deck-stage-fg/60">{t("useCode")}</p>
              <p
                className="font-mono text-[clamp(2.5rem,11cqw,6.5rem)] font-black leading-none tracking-[0.15em] text-deck-accent tabular-nums"
                aria-label={`${t("code")}: ${live ? joinCode : ""}`}
              >
                {live ? joinCode : "······"}
              </p>
            </div>
          )}
          {showQr && (
            <div className="space-y-[1.5cqw]">
              <div className="rounded-[2.5cqw] bg-deck-qr-bg p-[2cqw] shadow-2xl">
                {joinUrl ? (
                  <QRCodeSVG
                    value={joinUrl}
                    size={256}
                    role="img"
                    aria-label={t("scan")}
                    className="size-[24cqw] min-h-28 min-w-28"
                  />
                ) : (
                  <QrCode className="size-[24cqw] min-h-28 min-w-28 text-deck-stage-ink" aria-hidden />
                )}
              </div>
              <p className="text-[clamp(0.85rem,2.2cqw,1.3rem)] font-semibold text-deck-stage-fg/60">{t("scan")}</p>
            </div>
          )}
        </div>
      )}
      {text && (
        <p className="max-w-[90%] text-[clamp(1.1rem,3.4cqw,2.1rem)] font-semibold leading-snug text-deck-stage-fg/85 text-balance">
          {text}
        </p>
      )}
    </ContentStage>
  );
}
