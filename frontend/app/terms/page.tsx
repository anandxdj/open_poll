import type { Metadata } from "next";
import { LegalPage } from "@/features/landing/components/legal/LegalPage";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    // Placeholder text from the owner: replace it with the full terms of service before production.
    <LegalPage title="Terms of use">
      <p>Use of Open Poll should follow your organisation&apos;s policies and applicable law.</p>
    </LegalPage>
  );
}
