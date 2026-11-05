import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/contact";
import { Footer } from "../social/Footer";
import { Navbar } from "../hero/Navbar";
import { linkButton } from "../shared/styles";

/** Section heading inside a legal page. */
export const legalHeading = "pt-4 text-xl font-semibold tracking-[-0.02em] text-foreground";

/**
 * Shell for the Privacy and Terms pages: the landing header and footer around
 * a readable column (about 65 characters per line), the date the text last
 * changed, and the contact address at the end.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** When the text last changed, written out, e.g. "5 November 2026". */
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mk-surface relative flex min-h-dvh flex-col overflow-x-clip bg-background text-foreground">
      <a href="#main" className="mk-skip-link">
        Skip to content
      </a>
      <Navbar />

      <main id="main" className="flex-1 px-4 pb-24 pt-32 sm:px-6 sm:pt-36">
        <article className="mx-auto w-full max-w-2xl">
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{title}</h1>
          <p className="mt-4 text-sm text-muted-foreground">Last updated {updated}</p>

          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {children}

            <h2 className={legalHeading}>Contact</h2>
            <p>
              Questions about this page, your data or your account go to{" "}
              <a href={supportMailto(`Open Poll: ${title}`)} className="text-foreground underline underline-offset-4">
                {SUPPORT_EMAIL}
              </a>
              . We answer within a few working days.
            </p>
          </div>

          <Link href="/" className={`${linkButton({ variant: "outline", size: "touch" })} mt-10`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back home
          </Link>
        </article>
      </main>

      <Footer />
    </div>
  );
}
