import { Trophy } from "lucide-react";

import type { SlideTypeMeta } from "../../meta";

// System slide: shows the running leaderboard. Decks can contain it (API, MCP,
// AI drafts) but the builder's picker does not offer it.
export const meta: SlideTypeMeta = {
  type: "leaderboard",
  label: "Leaderboard",
  description: "Shows the current quiz standings — no answers collected",
  Icon: Trophy,
  iconClass: "text-amber-400",
  section: "system",
  scored: false,
  order: 900,
};
