import type { Metadata } from "next";

import { NO_INDEX } from "@/lib/seo/site";

// The OAuth return page: nothing to index.
export const metadata: Metadata = { robots: NO_INDEX };

export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
