import { Video } from "lucide-react";

import { readVideo } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

const PROVIDER_LABEL = { youtube: "YouTube video", vimeo: "Vimeo video", file: "Uploaded video" } as const;

export const meta: SlideTypeMeta = {
  type: "video",
  label: "Video",
  description: "A YouTube or Vimeo video, or an uploaded file",
  Icon: Video,
  iconClass: "text-red-400",
  section: "content",
  scored: false,
  order: 160,
  summary: (slide) => {
    const video = readVideo(slide.content);
    return video.id || video.key ? PROVIDER_LABEL[video.provider] : "";
  },
};
