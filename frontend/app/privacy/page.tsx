import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { LegalPage } from "@/features/landing/components/legal/LegalPage";

export const metadata: Metadata = pageMetadata("/privacy");

const heading = "pt-4 text-xl font-semibold tracking-[-0.02em] text-foreground";

export default function PrivacyPage() {
  return (
    // Placeholder text from the owner: replace it with the full privacy policy before production.
    // The "Your data" part describes what the product does (W4-C) and stays accurate as it is.
    <LegalPage title="Privacy">
      <p>
        We describe here only that Open Poll may collect usage data needed to run the polls and analytics you
        configure.
      </p>

      <h2 className={heading}>Your data</h2>
      <p>
        Signed in, you can download a copy of what Open Poll keeps about you from Settings, Privacy: your profile,
        workspaces, polls, decks, the sessions you ran and your activity, as JSON files in a zip.
      </p>
      <p>
        You can delete your account from the same page. We delete it 30 days later, with your personal workspace and
        everything in it. Log in before then and nothing is deleted. In team workspaces, what you made stays with the
        team, credited to a deleted user.
      </p>
      <h2 className={heading}>Joining a session</h2>
      <p>
        People who join a live session don&apos;t need an account. We keep the nickname they choose and their answers
        with the session. After a session ends, a participant can remove their name and answers from their results
        page. Each workspace decides how long it keeps session results; then the session is deleted with its
        participants and answers.
      </p>
    </LegalPage>
  );
}
