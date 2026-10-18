"use client";

import { ContentCard, LookAtScreen, showsSlideOnDevice } from "../../content/ContentViews";
import { contentOf, readBullets } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";

export function BulletsParticipant({ slide, mode }: ParticipantViewProps) {
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;
  const { title, items } = readBullets(contentOf(slide));
  return (
    <ContentCard>
      {title && <h2 className="text-2xl font-bold leading-tight tracking-tight">{title}</h2>}
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 text-base font-medium leading-snug">
            <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-deck-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </ContentCard>
  );
}
