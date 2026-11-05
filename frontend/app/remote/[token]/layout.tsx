import type { Metadata } from "next";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { enMessages } from "@/i18n/messages";
import { NO_INDEX } from "@/lib/seo/site";

// The pairing token is in the URL: never indexed, never sent on as a referrer.
export const metadata: Metadata = { title: enMessages.remote.meta.title, robots: NO_INDEX, referrer: "no-referrer" };

export default function RemoteLayout({ children }: { children: React.ReactNode }) {
  return <LiveIntlProvider>{children}</LiveIntlProvider>;
}
