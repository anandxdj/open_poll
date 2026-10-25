"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { MonitorPlay } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { LiveSlide } from "../../types";
import type { ParticipantMode, StageMode } from "../runtime";

// Shared layout pieces of the content slide views (heading, image, …).

/**
 * Whether a content ParticipantView draws the slide itself. While the
 * presenter drives the deck (`live`) the phone only points at the screen;
 * in audience pace the phone is the screen; previews show the slide.
 */
export const showsSlideOnDevice = (mode: ParticipantMode) => mode !== "live";

/** Presenter-paced content slide on a phone: the slide is on the big screen. */
export function LookAtScreen({ slide }: { slide: LiveSlide }) {
  const t = useTranslations("live");
  return (
    <div className="w-full text-center space-y-4 py-10" role="status">
      <span className="text-[10px] font-bold uppercase tracking-widest text-deck-primary/60">
        {t("participant.slideCounter", { current: slide.slideIndex + 1, total: slide.totalSlides })}
      </span>
      <div className="mx-auto flex size-20 items-center justify-center rounded-3xl border border-deck-primary/20 bg-deck-primary/10">
        <MonitorPlay className="size-10 text-deck-primary" aria-hidden />
      </div>
      <h2 className="text-2xl font-bold">{t("slides.content.lookAtScreen")}</h2>
      <p className="text-sm text-deck-muted-fg">{t("slides.content.lookAtScreenHint")}</p>
    </div>
  );
}

/**
 * Root of a content StageView: a size container, so type set in `cqw` scales
 * with the space the stage gives the slide (console, fullscreen, thumbnail).
 * Thumbnails render without the entrance animation.
 */
export function ContentStage({
  mode,
  className,
  children,
}: {
  mode: StageMode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "@container w-full font-sans text-deck-stage-fg",
        mode !== "thumbnail" && "animate-in fade-in zoom-in-95 duration-500",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Root of a content ParticipantView in audience pace or a preview. */
export function ContentCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("w-full space-y-4 text-deck-fg", className)}>{children}</div>;
}

/** Stand-in for media that is not set (or not loadable here). */
export function MediaPlaceholder({
  Icon,
  label,
  className,
  tone = "stage",
}: {
  Icon: LucideIcon;
  label: string;
  className?: string;
  tone?: "stage" | "device";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed text-center",
        tone === "stage"
          ? "border-deck-stage-fg/20 bg-deck-stage-fg/5 text-deck-stage-fg/50"
          : "border-deck-border bg-deck-surface text-deck-muted-fg",
        className
      )}
    >
      <Icon className="size-10" aria-hidden />
      <span className="max-w-[80%] text-sm font-semibold">{label}</span>
    </div>
  );
}
