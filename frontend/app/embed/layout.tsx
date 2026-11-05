import type { Metadata } from "next";
import { EmbedIntlProvider } from "@/features/embeds/EmbedIntlProvider";

// Embed pages (W4-D) live inside other sites: never indexed, and their URL (a
// stage carries a screen token) never leaks as a referrer. The proxy sets who
// may frame them (lib/proxy/embeds.ts).
export const metadata: Metadata = {
  title: "Embedded presentation",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <EmbedIntlProvider>{children}</EmbedIntlProvider>;
}
