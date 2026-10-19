import type { Metadata } from "next";
import { AcceptInvite } from "@/features/workspaces/invites/components/AcceptInvite";

export const metadata: Metadata = {
  title: "Accept invitation",
  // The URL is a credential: keep it out of search indexes and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvite token={token} />;
}
