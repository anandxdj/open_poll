"use client";

import { ContentCard, LookAtScreen, showsSlideOnDevice } from "../../content/ContentViews";
import { MarkdownLite } from "../../content/markdown";
import { contentOf, readParagraph } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";

export function ParagraphParticipant({ slide, mode }: ParticipantViewProps) {
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;
  const { title, body } = readParagraph(contentOf(slide));
  return (
    <ContentCard>
      {title && <h2 className="text-2xl font-bold leading-tight tracking-tight">{title}</h2>}
      <MarkdownLite
        text={body}
        linkable={mode === "audience"}
        className="space-y-3 text-base leading-relaxed text-deck-fg/90"
        classes={{
          strong: "font-bold text-deck-fg",
          em: "italic",
          link: "text-deck-primary underline underline-offset-4",
        }}
      />
    </ContentCard>
  );
}
