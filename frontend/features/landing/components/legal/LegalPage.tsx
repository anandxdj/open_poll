import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { Footer } from "../social/Footer";
import { Navbar } from "../hero/Navbar";
import { button } from "../shared/styles";

/**
 * Shell for the Privacy and Terms pages: the landing header and footer around
 * a readable column (about 65 characters per line), with a notice that the
 * text is a placeholder until the owner supplies the real policy.
 */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mk-surface relative flex min-h-dvh flex-col overflow-x-clip bg-radial-glow text-foreground">
      <a href="#main" className="mk-skip-link">
        Skip to content
      </a>
      <Navbar />

      <main id="main" className="flex-1 px-5 pb-24 pt-32 sm:px-6 sm:pt-36">
        <article className="mx-auto w-full max-w-2xl">
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>

          <div
            role="note"
            className="mt-8 flex gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-base leading-relaxed text-foreground"
          >
            <Info className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden="true" />
            <p>This page is a placeholder until the full text is published.</p>
          </div>

          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground sm:text-lg">{children}</div>

          <Link href="/" className={`${button.secondary} mt-10`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back home
          </Link>
        </article>
      </main>

      <Footer />
    </div>
  );
}
