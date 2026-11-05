import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { LegalPage, legalHeading } from "@/features/landing/components/legal/LegalPage";

export const metadata: Metadata = pageMetadata("/privacy");

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="5 November 2026">
      <p>
        This page explains what Open Poll keeps about you, why, who helps us run it, and what you can do about it. Open
        Poll is run by an individual based in India, who is responsible for your data. We don&apos;t sell personal data,
        and we don&apos;t use advertising or tracking cookies.
      </p>

      <h2 className={legalHeading}>If you have an account</h2>
      <ul className="list-disc space-y-2 pl-6">
        <li>
          Your name, email address and password (stored only as a one-way hash). If you sign in with Google or single
          sign-on, we get your name, email and profile picture from it instead of a password.
        </li>
        <li>What you create: workspaces, decks, polls, uploaded images and imported files, and their results.</li>
        <li>Membership of team workspaces, invitations, and an audit log of changes in team workspaces.</li>
        <li>MCP tokens and connected AI apps, stored as hashes, with when they were last used.</li>
      </ul>
      <p>We use this to run the service, keep it secure, and send the emails it needs, such as verification and password resets.</p>

      <h2 className={legalHeading}>If you join a session or answer a poll</h2>
      <p>
        You don&apos;t need an account. For a live session we keep the nickname you choose and your answers, Q&amp;A
        questions and reactions, with that session. A named poll also keeps the name and email you enter, so each
        person counts once. Your browser stores a random identifier so you can rejoin after a reload. The host of the
        session or poll sees these answers and decides what to do with them.
      </p>

      <h2 className={legalHeading}>Technical data</h2>
      <p>
        Our servers see your IP address and browser details with every request. We use them briefly for security and
        rate limiting (for example, to stop repeated login attempts), and in server logs that we keep for a short time to
        fix problems. We use one essential cookie to keep you signed in, and your browser&apos;s local storage for
        preferences such as the theme.
      </p>

      <h2 className={legalHeading}>Who helps us run Open Poll</h2>
      <ul className="list-disc space-y-2 pl-6">
        <li>MongoDB Atlas stores the database.</li>
        <li>Vercel serves the website. Our own cloud server runs the API and live sessions.</li>
        <li>Cloudflare provides DNS and stores uploaded files and encrypted backups.</li>
        <li>Resend sends our emails.</li>
        <li>
          An AI provider (Google Gemini or a compatible service) receives the text and deck content you give an AI
          feature, only when you use one.
        </li>
      </ul>
      <p>
        Some of these providers process data outside India. They act on our instructions and may not use your data for
        their own purposes.
      </p>

      <h2 className={legalHeading}>How long we keep it</h2>
      <p>
        Your account and content stay until you delete them. Session results are kept as long as the workspace&apos;s
        plan allows (365 days on the free plan), then the session is deleted with its participants and answers. Backups
        roll over within 14 days, so deleted data is gone from them after that.
      </p>

      <h2 className={legalHeading}>Your choices</h2>
      <p>
        Signed in, you can download a copy of what Open Poll keeps about you from Settings, Privacy: your profile,
        workspaces, polls, decks, the sessions you ran and your activity, as JSON files in a zip. You can correct your
        name on your profile.
      </p>
      <p>
        You can delete your account from the same page. We delete it 30 days later, with your personal workspace and
        everything in it. Log in before then and nothing is deleted. In team workspaces, what you made stays with the
        team, credited to a deleted user.
      </p>
      <p>
        After a session ends, a participant can remove their name and answers from their results page. For anything
        else, such as a correction or a question about how we use your data, write to us at the address below.
      </p>

      <h2 className={legalHeading}>Children</h2>
      <p>
        Open Poll is not meant for children to sign up on their own. A host who runs sessions with children is
        responsible for getting any consent the law requires, and should not ask them for personal details.
      </p>

      <h2 className={legalHeading}>Security and changes</h2>
      <p>
        Traffic is encrypted in transit, passwords and tokens are hashed, and single sign-on secrets are encrypted. We
        will update this page when what we do with data changes, and tell you in the app or by email about significant
        changes.
      </p>
    </LegalPage>
  );
}
