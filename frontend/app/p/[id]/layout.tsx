import type { Metadata } from "next";
import { NO_INDEX, SITE_NAME } from "@/lib/seo/site";

const INVITE = "Open the link to vote and see the results.";

// One person's poll, shared by link: open to anyone with it, kept out of search
// results, previewed in chats as an invitation to vote.
export const metadata: Metadata = {
  title: "Poll",
  description: INVITE,
  robots: NO_INDEX,
  openGraph: { title: `Answer this poll | ${SITE_NAME}`, description: INVITE },
  twitter: { title: `Answer this poll | ${SITE_NAME}`, description: INVITE },
};

// The page draws its own frame (PublicPageShell).
export default function PublicPollLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
