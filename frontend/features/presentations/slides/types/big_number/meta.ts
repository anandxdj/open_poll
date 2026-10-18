import { Hash } from "lucide-react";

import { readBigNumber } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "big_number",
  label: "Big number",
  description: "One headline figure with a short label",
  Icon: Hash,
  iconClass: "text-amber-400",
  section: "content",
  scored: false,
  order: 140,
  summary: (slide) => {
    const { value, label, prefix, suffix } = readBigNumber(slide.content);
    if (value === null) return label;
    const figure = `${prefix}${value}${suffix}`;
    return label ? `${figure} ${label}` : figure;
  },
};
