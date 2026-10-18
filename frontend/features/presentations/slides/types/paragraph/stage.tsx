"use client";

import { cn } from "@/lib/utils";
import { ContentStage } from "../../content/ContentViews";
import { MarkdownLite } from "../../content/markdown";
import { readParagraph } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";

/** Body size steps down as the text gets longer, so up to 2000 characters still fit the screen. */
const bodySize = (length: number) =>
  length > 900
    ? "text-[clamp(0.95rem,2.2cqw,1.35rem)]"
    : length > 400
      ? "text-[clamp(1rem,2.6cqw,1.6rem)]"
      : "text-[clamp(1.1rem,3.2cqw,2rem)]";

/** Title and markdown-lite body, left-aligned for reading. */
export function ParagraphStage({ slide, mode }: StageViewProps) {
  const { title, body } = readParagraph(slide.content);
  return (
    <ContentStage mode={mode} className="space-y-[3cqw] text-left">
      {title && (
        <h2 className="text-[clamp(1.6rem,5.5cqw,3.5rem)] font-extrabold leading-tight tracking-tight text-balance">
          {title}
        </h2>
      )}
      {body ? (
        <MarkdownLite
          text={body}
          linkable={mode !== "thumbnail"}
          className={cn(
            "space-y-[2cqw] leading-relaxed text-deck-stage-fg/85",
            bodySize(body.length),
            mode !== "thumbnail" && "max-h-[62vh] overflow-y-auto"
          )}
          classes={{
            strong: "font-bold text-deck-stage-fg",
            em: "italic",
            link: "text-deck-accent underline decoration-deck-accent/40 underline-offset-4",
          }}
        />
      ) : (
        <p className="text-[clamp(1.1rem,3.2cqw,2rem)] text-deck-stage-fg/30">Paragraph</p>
      )}
    </ContentStage>
  );
}
