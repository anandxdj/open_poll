"use client";

import { ImageIcon, ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { RemoteImage } from "@/features/media/RemoteImage";
import { cn } from "@/lib/utils";
import { ContentCard, LookAtScreen, MediaPlaceholder, showsSlideOnDevice } from "../../content/ContentViews";
import { contentOf, readImage } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";

export function ImageParticipant({ slide, mode }: ParticipantViewProps) {
  const t = useTranslations("live.slides.image");
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;
  const { url, alt, fit, caption } = readImage(contentOf(slide));
  const placeholderClass = "h-56 w-full";

  return (
    <ContentCard>
      <figure className="space-y-3">
        {url ? (
          <RemoteImage
            src={url}
            alt={alt}
            className={cn(
              "w-full rounded-2xl border border-deck-border bg-deck-surface",
              fit === "cover" ? "aspect-video object-cover" : "max-h-[60vh] object-contain"
            )}
            fallback={
              <MediaPlaceholder Icon={ImageOff} label={t("unavailable")} tone="device" className={placeholderClass} />
            }
          />
        ) : (
          <MediaPlaceholder Icon={ImageIcon} label={alt || t("missing")} tone="device" className={placeholderClass} />
        )}
        {caption && <figcaption className="text-center text-sm text-deck-muted-fg">{caption}</figcaption>}
      </figure>
    </ContentCard>
  );
}
