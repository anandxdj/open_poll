import { SlidersHorizontal } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "scales",
  label: "Scales",
  description: "Rate statements on a slider, see live averages",
  Icon: SlidersHorizontal,
  iconClass: "text-violet-400",
  section: "interactive",
  scored: false,
  order: 50,
};
