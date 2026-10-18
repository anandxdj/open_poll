import { QrCode } from "lucide-react";

import { oneLine, readInstructions } from "../../content/payloads";
import type { SlideTypeMeta } from "../../meta";

export const meta: SlideTypeMeta = {
  type: "instructions",
  label: "How to join",
  description: "The join address, code and QR, any time mid-deck",
  Icon: QrCode,
  iconClass: "text-violet-400",
  section: "content",
  scored: false,
  order: 170,
  summary: (slide) => oneLine(readInstructions(slide.content).text),
};
