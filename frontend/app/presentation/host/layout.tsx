import type { Metadata } from "next";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { NO_INDEX } from "@/lib/seo/site";

export const metadata: Metadata = { title: "Host console", robots: NO_INDEX };

// The host console renders the same slide views and standings as the
// participant routes (messages/en/live.json) plus its own chrome
// (messages/en/presenter.json); LiveIntlProvider ships both.
export default function PresentationHostLayout({ children }: { children: React.ReactNode }) {
  return <LiveIntlProvider>{children}</LiveIntlProvider>;
}
