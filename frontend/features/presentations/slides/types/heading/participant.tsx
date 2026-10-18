"use client";

import { ContentCard, LookAtScreen, showsSlideOnDevice } from "../../content/ContentViews";
import { contentOf, readHeading } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";

export function HeadingParticipant({ slide, mode }: ParticipantViewProps) {
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;
  const { title, subtitle } = readHeading(contentOf(slide));
  return (
    <ContentCard className="py-6 text-center">
      <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-balance">{title}</h2>
      <span aria-hidden className="mx-auto block h-1 w-12 rounded-full bg-deck-primary" />
      {subtitle && <p className="text-base text-deck-muted-fg text-balance">{subtitle}</p>}
    </ContentCard>
  );
}
