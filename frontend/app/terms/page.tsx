import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { LegalPage, legalHeading } from "@/features/landing/components/legal/LegalPage";

export const metadata: Metadata = pageMetadata("/terms");

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="5 November 2026">
      <p>
        These terms apply when you use Open Poll at open-poll.anands.dev, its API and its MCP connector. Open Poll is
        run by an individual based in India (&quot;we&quot;). By creating an account or joining a session you agree to
        them.
      </p>

      <h2 className={legalHeading}>The service</h2>
      <p>
        Open Poll lets you build decks with interactive slides, run them live with an audience that joins by code, run
        polls and quizzes by link, and read the results. Some features use AI to draft content. We keep improving the
        service, so features can change.
      </p>

      <h2 className={legalHeading}>Your account</h2>
      <p>
        You need an account to create and present. Give accurate details, keep your password to yourself, and tell us if
        you think someone else is using your account. You are responsible for what happens in it, including actions by
        AI apps and tokens you connect. You must be old enough to agree to these terms where you live, or have a parent,
        guardian or school agree for you.
      </p>

      <h2 className={legalHeading}>Your content and your audience</h2>
      <p>
        What you create stays yours. You give us permission to store, copy, display and process it only as needed to run
        Open Poll for you, for example to show your slides to the people who join your session.
      </p>
      <p>
        When you collect answers, you decide what to ask and who to ask. Make sure you are allowed to collect what you
        ask for, and tell your audience how you will use their answers. Don&apos;t ask for passwords, payment details or
        sensitive personal data.
      </p>

      <h2 className={legalHeading}>Acceptable use</h2>
      <p>Don&apos;t use Open Poll to:</p>
      <ul className="list-disc space-y-2 pl-6">
        <li>break the law or infringe anyone&apos;s rights, including copyright and privacy;</li>
        <li>harass, threaten or deceive people, or share hateful, sexual or violent content;</li>
        <li>send spam, phish, or collect people&apos;s data without their knowledge;</li>
        <li>
          probe, overload or get around the security, rate limits or plan limits of the service, or access it with
          automated tools other than our API and MCP connector;
        </li>
        <li>resell the service or copy it to build a competing product.</li>
      </ul>
      <p>
        We may remove content or suspend an account that breaks these rules, and we will tell you why unless the law or
        safety stops us.
      </p>

      <h2 className={legalHeading}>AI features</h2>
      <p>
        AI drafts can be wrong or incomplete. Check them before you present. When you use an AI feature, the text you
        give it and the parts of your deck it needs are sent to our AI provider to produce the result.
      </p>

      <h2 className={legalHeading}>Plans and limits</h2>
      <p>
        Open Poll is free today, with the limits shown on the pricing section of the home page (for example 100
        participants per session or poll, and results kept for 365 days). If we offer paid plans, their price and terms
        are shown before you pay, and you can cancel at any time.
      </p>

      <h2 className={legalHeading}>Availability and liability</h2>
      <p>
        We work to keep Open Poll running and your data safe, but we provide it &quot;as is&quot;, without promises that
        it will always be available or free of errors. Keep your own copy of results that matter: you can export them at
        any time.
      </p>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential losses, lost profits or lost data,
        and our total liability for any claim is limited to the amount you paid us in the 12 months before it, or
        ₹1,000 if you paid nothing. Nothing here limits liability that the law does not let us limit.
      </p>

      <h2 className={legalHeading}>Ending</h2>
      <p>
        You can stop using Open Poll and delete your account at any time from Settings, Privacy. We may close an account
        that seriously or repeatedly breaks these terms. If we ever shut the service down, we will give at least 30
        days&apos; notice so you can export your data.
      </p>

      <h2 className={legalHeading}>Changes and law</h2>
      <p>
        We may update these terms. For a significant change we will give notice in the app or by email before it takes
        effect; continuing to use Open Poll after that means you accept the new terms. These terms are governed by the
        laws of India, and disputes go to the courts of India.
      </p>
    </LegalPage>
  );
}
