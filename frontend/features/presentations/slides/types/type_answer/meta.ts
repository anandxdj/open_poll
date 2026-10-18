import { Keyboard } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "type_answer",
  label: "Type Answer",
  description: "Scored free text matched against accepted answers",
  Icon: Keyboard,
  iconClass: "text-emerald-400",
  section: "competition",
  scored: true,
  order: 20,
};
