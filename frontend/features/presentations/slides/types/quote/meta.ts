import { Quote } from "lucide-react";

import { oneLine, readQuote } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "quote",
  label: "Quote",
  description: "A quotation with who said it",
  Icon: Quote,
  iconClass: "text-rose-400",
  section: "content",
  scored: false,
  order: 150,
  summary: (slide) => oneLine(readQuote(slide.content).text),
};
