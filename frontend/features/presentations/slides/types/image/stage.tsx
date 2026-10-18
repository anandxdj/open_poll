"use client";

import { ImageIcon, ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { RemoteImage } from "@/features/media/RemoteImage";
import { cn } from "@/lib/utils";
import { ContentStage, MediaPlaceholder } from "../../content/ContentViews";
import { readImage } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";

/** The image as large as the stage allows, in its fit mode, with the caption below. */
export function ImageStage({ slide, mode }: StageViewProps) {
  const t = useTranslations("live.slides.image");
  const { url, alt, fit, caption } = readImage(slide.content);
  const placeholderClass = "size-full rounded-none border-0";

  return (
    <ContentStage mode={mode}>
      <figure className="flex flex-col items-center gap-[2cqw]">
        <div
          className={cn(
            "w-full overflow-hidden rounded-[2cqw] border border-deck-stage-fg/10 bg-deck-stage-panel shadow-2xl",
            mode === "thumbnail" ? "h-[360px]" : "h-[58vh]"
          )}
        >
          {url ? (
            <RemoteImage
              src={url}
              alt={alt}
              className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")}
              fallback={<MediaPlaceholder Icon={ImageOff} label={t("unavailable")} className={placeholderClass} />}
            />
          ) : (
            <MediaPlaceholder Icon={ImageIcon} label={alt || t("missing")} className={placeholderClass} />
          )}
        </div>
        {caption && (
          <figcaption className="text-center text-[clamp(0.95rem,2.6cqw,1.6rem)] font-medium text-deck-stage-fg/70 text-balance">
            {caption}
          </figcaption>
        )}
      </figure>
    </ContentStage>
  );
}
