"use client";

import { Quote } from "lucide-react";

import { cn } from "@/lib/utils";
import { ContentStage } from "../../content/ContentViews";
import { readQuote } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";

/** The quotation set large, the attribution under it. */
export function QuoteStage({ slide, mode }: StageViewProps) {
  const { text, attribution } = readQuote(slide.content);
  const long = text.length > 220;
  return (
    <ContentStage mode={mode}>
      <figure className="mx-auto flex max-w-[94%] flex-col items-center gap-[3cqw] py-[2cqw] text-center">
        <Quote aria-hidden className="size-[8cqw] min-h-8 min-w-8 fill-current text-deck-accent" />
        <blockquote
          className={cn(
            "font-semibold leading-snug tracking-tight text-balance",
            long ? "text-[clamp(1.2rem,3.6cqw,2.3rem)]" : "text-[clamp(1.5rem,5.2cqw,3.4rem)]",
            !text && "text-deck-stage-fg/30"
          )}
        >
          {text || "Quote"}
        </blockquote>
        {attribution && (
          <figcaption className="text-[clamp(1rem,2.8cqw,1.7rem)] font-medium text-deck-stage-fg/60">
            — {attribution}
          </figcaption>
        )}
      </figure>
    </ContentStage>
  );
}
