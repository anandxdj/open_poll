"use client";

import { useFormatter } from "next-intl";

import { ContentCard, LookAtScreen, showsSlideOnDevice } from "../../content/ContentViews";
import { contentOf, readBigNumber } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";
import { fractionDigits } from "./format";

export function BigNumberParticipant({ slide, mode }: ParticipantViewProps) {
  const format = useFormatter();
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;
  const { value, label, prefix, suffix } = readBigNumber(contentOf(slide));
  const target = value ?? 0;
  const digits = fractionDigits(target);

  return (
    <ContentCard className="py-6 text-center">
      <p className="flex flex-wrap items-baseline justify-center text-6xl font-black leading-none tracking-tight text-deck-primary tabular-nums">
        {prefix && <span className="mr-1 text-3xl">{prefix}</span>}
        <span>{format.number(target, { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>
        {suffix && <span className="ml-1 text-3xl">{suffix}</span>}
      </p>
      {label && <p className="text-lg font-semibold text-deck-fg/80 text-balance">{label}</p>}
    </ContentCard>
  );
}
