"use client";

import { Video } from "lucide-react";
import { useTranslations } from "next-intl";

import { canEmbed, VideoEmbed } from "@/features/media/VideoEmbed";
import { ContentCard, LookAtScreen, MediaPlaceholder, showsSlideOnDevice } from "../../content/ContentViews";
import { contentOf, readVideo } from "../../content/payloads";
import type { ParticipantViewProps } from "../../runtime";
import { useProviderName } from "./providerName";

export function VideoParticipant({ slide, mode }: ParticipantViewProps) {
  const t = useTranslations("live.slides.video");
  const video = readVideo(contentOf(slide));
  const provider = useProviderName(video.provider);
  if (!showsSlideOnDevice(mode)) return <LookAtScreen slide={slide} />;

  return (
    <ContentCard>
      <div className="aspect-video w-full overflow-hidden rounded-2xl border border-deck-border bg-deck-surface">
        {canEmbed(video) && mode === "audience" ? (
          <VideoEmbed video={video} title={t("title", { provider })} />
        ) : (
          <MediaPlaceholder
            Icon={Video}
            label={canEmbed(video) ? t("title", { provider }) : t("missing")}
            tone="device"
            className="size-full rounded-none border-0"
          />
        )}
      </div>
    </ContentCard>
  );
}
