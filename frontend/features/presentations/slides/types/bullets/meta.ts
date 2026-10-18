import { List } from "lucide-react";

import { readBullets } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "bullets",
  label: "Bullet list",
  description: "Up to ten key points, revealed one after another",
  Icon: List,
  iconClass: "text-teal-400",
  section: "content",
  scored: false,
  order: 120,
  summary: (slide) => {
    const { title, items } = readBullets(slide.content);
    return title || items.find((item) => item.trim()) || "";
  },
};
