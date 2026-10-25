import type { Metadata } from "next";

import { NO_INDEX } from "@/lib/seo/site";

// Component test pages for development.
export const metadata: Metadata = { title: "Test", robots: NO_INDEX };

export default function TestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
