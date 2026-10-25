import type { Metadata } from "next";

import { NO_INDEX, SITE_NAME } from "@/lib/seo/site";

const INVITE = "Answer live polls, quizzes and Q&A from your phone. No account needed.";

// One session's participant view. Its URL holds a join code, so it stays out of
// search results, but a link shared in a chat still previews as an invitation.
export const metadata: Metadata = {
  // The /live layout's plain title ends the root template, so this segment sets its own.
  title: { absolute: `Live session | ${SITE_NAME}`, template: `%s | ${SITE_NAME}` },
  description: INVITE,
  robots: NO_INDEX,
  alternates: { canonical: null },
  openGraph: { title: `Join the live session | ${SITE_NAME}`, description: INVITE, url: null },
  twitter: { title: `Join the live session | ${SITE_NAME}`, description: INVITE },
};

export default function LiveSessionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
