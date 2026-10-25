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

export default function PublicPollLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground md:flex md:items-center md:justify-center md:py-16">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </div>
  );
}
