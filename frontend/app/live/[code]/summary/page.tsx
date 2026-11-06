import type { Metadata } from "next";
import { SessionsIntlProvider } from "@/features/sessions/SessionsIntlProvider";
import { ParticipantSummary } from "@/features/sessions/components/ParticipantSummary";
import { enMessages } from "@/i18n/messages";
import { SITE_NAME } from "@/lib/seo/site";

const title = enMessages.live.meta.resultsTitle;

export const metadata: Metadata = {
  title,
  robots: { index: false, follow: false },
  // Not the parent's "Join the live session" card: this page is one participant's results.
  openGraph: { title: `${title} | ${SITE_NAME}`, url: null },
  twitter: { title: `${title} | ${SITE_NAME}` },
};

// A participant's own results: `?sid=` pins the session (the end screen links it),
// otherwise the newest session stored in this browser for the code is used.
export default async function ParticipantSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ sid?: string | string[] }>;
}) {
  const { code } = await params;
  const { sid } = await searchParams;
  return (
    <SessionsIntlProvider>
      <ParticipantSummary code={code} sessionId={typeof sid === "string" ? sid : null} />
    </SessionsIntlProvider>
  );
}
