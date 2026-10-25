"use client";

import { Play, Video } from "lucide-react";
import { useTranslations } from "next-intl";

import { canEmbed, VideoEmbed } from "@/features/media/VideoEmbed";
import { ContentStage, MediaPlaceholder } from "../../content/ContentViews";
import { readVideo } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";
import { useProviderName } from "./providerName";

/** A 16:9 player filling the stage width; thumbnails show a still stand-in instead of loading the player. */
export function VideoStage({ slide, mode }: StageViewProps) {
  const t = useTranslations("live.slides.video");
  const video = readVideo(slide.content);
  const provider = useProviderName(video.provider);
  const playable = canEmbed(video);
  const placeholderClass = "size-full rounded-none border-0";

  return (
    <ContentStage mode={mode}>
      <div className="aspect-video w-full overflow-hidden rounded-[2cqw] border border-deck-stage-fg/10 bg-deck-stage-scrim shadow-2xl">
        {playable && mode !== "thumbnail" ? (
          <VideoEmbed video={video} title={t("title", { provider })} />
        ) : playable ? (
          <MediaPlaceholder Icon={Play} label={t("title", { provider })} className={placeholderClass} />
        ) : (
          <MediaPlaceholder Icon={Video} label={t("missing")} className={placeholderClass} />
        )}
      </div>
    </ContentStage>
  );
}
