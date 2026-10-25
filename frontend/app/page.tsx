import type { Metadata } from "next";

import { LandingPage } from "@/features/landing";
import { landingJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";
import { pageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = pageMetadata("/");

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(landingJsonLd()) }} />
      <LandingPage />
    </>
  );
}
