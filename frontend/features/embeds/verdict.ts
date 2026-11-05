import { headers } from "next/headers";
import { EMBED_POLICY_HEADER } from "@/lib/proxy/embeds";

export type EmbedNoticeKind = "disabled" | "notFound";

/** The proxy's verdict (`x-openpoll-embed`) as a notice kind, or null when the embed may render. */
export function noticeFor(verdict: string | null): EmbedNoticeKind | null {
  if (verdict === "allowed") return null;
  return verdict === "EMBED_DISABLED" ? "disabled" : "notFound";
}

/**
 * Server components of the embed pages: what the proxy decided for this
 * request (`lib/proxy/embeds.ts`). No verdict at all means the proxy did not
 * run, so the page does not render either.
 */
export async function embedNotice(): Promise<EmbedNoticeKind | null> {
  return noticeFor((await headers()).get(EMBED_POLICY_HEADER));
}
