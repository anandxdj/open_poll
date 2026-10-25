"use client";

import { Quote } from "lucide-react";

import { ContentCard, LookAtScreen, showsSlideOnDevice } from "../../content/ContentViews";
import { contentOf, readQuote } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";

export function QuoteParticipant({ slide, mode }: ParticipantViewProps) {
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;
  const { text, attribution } = readQuote(contentOf(slide));
  return (
    <ContentCard>
      <figure className="space-y-4 py-4 text-center">
        <Quote aria-hidden className="mx-auto size-8 fill-current text-deck-primary" />
        <blockquote className="text-xl font-semibold leading-snug text-balance">{text}</blockquote>
        {attribution && <figcaption className="text-sm text-deck-muted-fg">— {attribution}</figcaption>}
      </figure>
    </ContentCard>
  );
}
