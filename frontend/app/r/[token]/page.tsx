import type { Metadata } from "next";
import { SessionsIntlProvider } from "@/features/sessions/SessionsIntlProvider";
import { PublicResultsView } from "@/features/sessions/components/PublicResultsView";

// A shared session's results. The link is a capability: search engines must not index it
// and the browser must not leak it as a referrer.
export const metadata: Metadata = {
  title: "Shared results",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function PublicResultsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <SessionsIntlProvider>
      <PublicResultsView token={token} />
    </SessionsIntlProvider>
  );
}
