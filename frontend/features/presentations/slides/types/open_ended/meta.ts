import { MessageSquareText } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "open_ended",
  label: "Open Ended",
  description: "Free-form responses shown as a card wall",
  Icon: MessageSquareText,
  iconClass: "text-pink-400",
  section: "interactive",
  scored: false,
  order: 40,
};
