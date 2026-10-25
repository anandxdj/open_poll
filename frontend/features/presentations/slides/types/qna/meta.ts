import { MessageCircleQuestion } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

// Board slide: shows the audience's questions on the stage; while it is on
// screen participants can ask even when the deck's Q&A setting is off.
export const meta: SlideTypeMeta = {
  type: "qna",
  label: "Q&A",
  description: "The audience asks and upvotes questions; you pick what to answer",
  Icon: MessageCircleQuestion,
  iconClass: "text-orange-400",
  section: "interactive",
  scored: false,
  order: 70,
};
