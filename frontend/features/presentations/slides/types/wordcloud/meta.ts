import { Cloud } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "wordcloud",
  label: "Word Cloud",
  description: "Collect words that grow with every repeat",
  Icon: Cloud,
  iconClass: "text-rose-400",
  section: "interactive",
  scored: false,
  order: 30,
};
