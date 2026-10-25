import { Grid2x2 } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "grid_2x2",
  label: "2 by 2 Grid",
  description: "Everyone places your items on two axes, like effort and impact",
  Icon: Grid2x2,
  iconClass: "text-cyan-400",
  section: "advanced",
  scored: false,
  order: 90,
};
