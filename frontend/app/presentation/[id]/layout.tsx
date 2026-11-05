import type { Metadata } from "next";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { NO_INDEX } from "@/lib/seo/site";

export const metadata: Metadata = { title: "Presenter view", robots: NO_INDEX };

// The presenter view and its audience window (W2-A) render the host console's
// stage and chrome strings (messages/en/presenter.json, live.json).
export default function PresentationViewsLayout({ children }: { children: React.ReactNode }) {
  return <LiveIntlProvider>{children}</LiveIntlProvider>;
}
