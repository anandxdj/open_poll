import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { LegalPage } from "@/features/landing/components/legal/LegalPage";

export const metadata: Metadata = pageMetadata("/terms");

export default function TermsPage() {
  return (
    // Placeholder text from the owner: replace it with the full terms of service before production.
    <LegalPage title="Terms of use">
      <p>Use of Open Poll should follow your organisation&apos;s policies and applicable law.</p>
    </LegalPage>
  );
}
