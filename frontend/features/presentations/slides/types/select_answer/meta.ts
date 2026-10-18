import { ListChecks } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "select_answer",
  label: "Select Answer",
  description: "Scored multiple choice — fastest correct answer wins",
  Icon: ListChecks,
  iconClass: "text-indigo-400",
  section: "competition",
  scored: true,
  order: 10,
};
