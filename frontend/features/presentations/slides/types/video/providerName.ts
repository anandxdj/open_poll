"use client";

import { useTranslations } from "next-intl";
import type { VideoProvider } from "../../../types/content";

/** Display name of a video source ("YouTube", "Vimeo", localized "Uploaded"). */
export function useProviderName(provider: VideoProvider): string {
  const t = useTranslations("live.slides.video");
  return provider === "youtube" ? "YouTube" : provider === "vimeo" ? "Vimeo" : t("uploaded");
}
