import type { Metadata } from "next";
import { OAuthConsent } from "@/features/mcp/components/OAuthConsent";

export const metadata: Metadata = {
  title: "Connect an app",
  // The request id in the URL is a credential: keep it out of search indexes and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string | string[] }>;
}) {
  const { request } = await searchParams;
  const requestId = Array.isArray(request) ? (request[0] ?? "") : (request ?? "");
  return <OAuthConsent requestId={requestId} />;
}
