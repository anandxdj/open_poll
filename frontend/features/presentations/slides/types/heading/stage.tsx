"use client";

import { cn } from "@/lib/utils";
import { ContentStage } from "../../content/ContentViews";
import { readHeading } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";

/** Title slide: a large title, an accent rule and the subtitle. */
export function HeadingStage({ slide, mode }: StageViewProps) {
  const { title, subtitle } = readHeading(slide.content);
  return (
    <ContentStage mode={mode} className="flex flex-col items-center gap-[3cqw] py-[4cqw] text-center">
      <h2
        className={cn(
          "text-[clamp(2rem,8.5cqw,5.5rem)] font-extrabold leading-[1.05] tracking-tight text-balance",
          !title && "text-deck-stage-fg/30"
        )}
      >
        {title || "Heading"}
      </h2>
      <span aria-hidden className="h-1.5 w-[10cqw] min-w-12 rounded-full bg-deck-accent" />
      {subtitle && (
        <p className="text-[clamp(1.1rem,3.4cqw,2.1rem)] font-medium leading-snug text-deck-stage-fg/65 text-balance">
          {subtitle}
        </p>
      )}
    </ContentStage>
  );
}
