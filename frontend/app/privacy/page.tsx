import type { Metadata } from "next";
import { LegalPage } from "@/features/landing/components/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    // Placeholder text from the owner: replace it with the full privacy policy before production.
    <LegalPage title="Privacy">
      <p>
        We describe here only that Open Poll may collect usage data needed to run the polls and analytics you
        configure.
      </p>
    </LegalPage>
  );
}
