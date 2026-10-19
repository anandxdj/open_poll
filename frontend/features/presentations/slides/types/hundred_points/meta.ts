import { Coins } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "hundred_points",
  label: "100 Points",
  description: "Everyone shares 100 points between your items; see where the points go",
  Icon: Coins,
  iconClass: "text-yellow-400",
  section: "advanced",
  scored: false,
  order: 80,
};
