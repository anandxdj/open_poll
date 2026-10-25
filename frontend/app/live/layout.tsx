import type { Metadata } from "next";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { pageMetadata } from "@/lib/seo/site";

// The join page is public; `[code]` below overrides this with noindex.
export const metadata: Metadata = pageMetadata("/live");

// Participant-facing live routes get translated strings (messages/<locale>/live.json).
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return <LiveIntlProvider>{children}</LiveIntlProvider>;
}
