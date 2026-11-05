import type { Metadata } from "next";
import { EmbedIntlProvider } from "@/features/embeds/EmbedIntlProvider";

// Add-in panes (W4-D) run inside PowerPoint, Teams and Zoom. Never indexed, no
// referrer (their URLs may carry a screen link). Framing rules per host come
// from next.config (lib/security/headers.ts).
export const metadata: Metadata = {
  title: "Open Poll add-in",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function AddinsLayout({ children }: { children: React.ReactNode }) {
  return <EmbedIntlProvider>{children}</EmbedIntlProvider>;
}
