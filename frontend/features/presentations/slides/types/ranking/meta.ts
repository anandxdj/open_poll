import { ListOrdered } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "ranking",
  label: "Ranking",
  description: "Order items — combined ranking at reveal",
  Icon: ListOrdered,
  iconClass: "text-green-400",
  section: "interactive",
  scored: false,
  order: 60,
};
