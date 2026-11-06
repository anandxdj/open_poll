import type { Metadata } from "next";

import { enMessages } from "@/i18n/messages";
import { NO_INDEX, SITE_NAME } from "@/lib/seo/site";

// Page titles come from the message files like every other string of the live surfaces (W4-A);
// metadata is built on the server, before the participant's locale is known, so it reads English.
const { meta } = enMessages.live;
const INVITE = meta.sessionDescription;

// One session's participant view. Its URL holds a join code, so it stays out of
// search results, but a link shared in a chat still previews as an invitation.
export const metadata: Metadata = {
  // The /live layout's plain title ends the root template, so this segment sets its own.
  title: { absolute: `${meta.sessionTitle} | ${SITE_NAME}`, template: `%s | ${SITE_NAME}` },
  description: INVITE,
  robots: NO_INDEX,
  alternates: { canonical: null },
  openGraph: { title: `${meta.sessionShareTitle} | ${SITE_NAME}`, description: INVITE, url: null },
  twitter: { title: `${meta.sessionShareTitle} | ${SITE_NAME}`, description: INVITE },
};

export default function LiveSessionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
