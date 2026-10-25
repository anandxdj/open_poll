import { Pilcrow } from "lucide-react";

import { oneLine, readParagraph } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "paragraph",
  label: "Paragraph",
  description: "A block of text with bold, italic and links",
  Icon: Pilcrow,
  iconClass: "text-slate-400",
  section: "content",
  scored: false,
  order: 110,
  summary: (slide) => {
    const { title, body } = readParagraph(slide.content);
    return title || oneLine(body);
  },
};
