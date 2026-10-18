import { ImageIcon } from "lucide-react";

import { readImage } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "image",
  label: "Image",
  description: "One picture with alt text and an optional caption",
  Icon: ImageIcon,
  iconClass: "text-emerald-400",
  section: "content",
  scored: false,
  order: 130,
  summary: (slide) => {
    const { caption, alt } = readImage(slide.content);
    return caption || alt;
  },
};
