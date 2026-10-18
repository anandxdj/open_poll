import { Heading1 } from "lucide-react";

import { readHeading } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "heading",
  label: "Heading",
  description: "A title and subtitle to open the deck or a section",
  Icon: Heading1,
  iconClass: "text-sky-400",
  section: "content",
  scored: false,
  order: 100,
  summary: (slide) => readHeading(slide.content).title,
};
