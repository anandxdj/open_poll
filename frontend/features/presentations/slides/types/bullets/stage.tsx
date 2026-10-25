"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { ContentStage } from "../../content/ContentViews";
import { readBullets } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";
import { ease } from "../../shared";

/** Title over the points; live, the points slide in one after another. */
export function BulletsStage({ slide, mode }: StageViewProps) {
  const { title, items } = readBullets(slide.content);
  const animate = mode === "live";
  const dense = items.length > 6;
  const points = items.length > 0 ? items : ["", ""];

  return (
    <ContentStage mode={mode} className="space-y-[3.5cqw] text-left">
      {title && (
        <h2 className="text-[clamp(1.6rem,5.5cqw,3.5rem)] font-extrabold leading-tight tracking-tight text-balance">
          {title}
        </h2>
      )}
      <ul className={dense ? "space-y-[1.4cqw]" : "space-y-[2.4cqw]"}>
        {points.map((item, i) => (
          <motion.li
            key={i}
            initial={animate ? { opacity: 0, x: -24 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: animate ? 0.15 + 0.12 * i : 0, ease }}
            className={cn(
              "flex items-start gap-[2cqw] font-semibold leading-snug",
              dense ? "text-[clamp(1rem,2.8cqw,1.7rem)]" : "text-[clamp(1.15rem,3.8cqw,2.4rem)]"
            )}
          >
            <span aria-hidden className="mt-[0.42em] size-[0.42em] shrink-0 rounded-full bg-deck-accent" />
            {item ? (
              <span>{item}</span>
            ) : (
              <span aria-hidden className="mt-[0.2em] h-[0.7em] w-2/3 rounded-full bg-deck-stage-fg/10" />
            )}
          </motion.li>
        ))}
      </ul>
    </ContentStage>
  );
}
