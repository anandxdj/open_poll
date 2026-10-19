import { Target } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "guess_number",
  label: "Guess the Number",
  description: "Everyone picks a number on a slider; optionally score guesses near the answer",
  Icon: Target,
  iconClass: "text-orange-400",
  section: "advanced",
  // Can award points, but only while a correct number is set (blank slides are ungraded).
  scored: true,
  order: 70,
};
