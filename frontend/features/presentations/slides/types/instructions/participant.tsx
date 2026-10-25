"use client";

import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useLiveOptional } from "../../../live/store";
import { ContentCard, LookAtScreen, showsSlideOnDevice } from "../../content/ContentViews";
import { contentOf, readInstructions } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";

/** On a phone that already joined: confirmation, the code to share, and the extra text. */
export function InstructionsParticipant({ slide, mode }: ParticipantViewProps) {
  const t = useTranslations("live.slides.instructions");
  const joinCode = useLiveOptional((s) => s.joinCode);
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;
  const { showCode, text } = readInstructions(contentOf(slide));

  return (
    <ContentCard className="py-6 text-center">
      <CheckCircle2 className="mx-auto size-10 text-deck-correct-soft" aria-hidden />
      <p className="font-bold">{t("connected")}</p>
      {showCode && joinCode && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-deck-muted-fg">{t("code")}</p>
          <p className="font-mono text-4xl font-black tracking-[0.15em] text-deck-primary tabular-nums">{joinCode}</p>
        </div>
      )}
      {text && <p className="text-base text-deck-fg/85 text-balance">{text}</p>}
    </ContentCard>
  );
}
