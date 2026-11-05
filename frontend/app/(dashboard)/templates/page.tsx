import type { Metadata } from "next";

import { TemplatesView } from "@/features/templates/components/TemplatesView";

export const metadata: Metadata = { title: "Templates" };

// Starter decks and the workspace's saved templates; "Use template" opens a new draft in the builder.
export default function TemplatesPage() {
  return <TemplatesView />;
}
