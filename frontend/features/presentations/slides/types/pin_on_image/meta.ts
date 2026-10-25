import { MapPin } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "pin_on_image",
  label: "Pin on Image",
  description: "Everyone drops a pin on your image; optionally score pins in the right area",
  Icon: MapPin,
  iconClass: "text-fuchsia-400",
  section: "advanced",
  // Can award points, but only while a correct area is marked (blank slides are ungraded).
  scored: true,
  order: 100,
};
