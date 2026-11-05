"use client";

import "./globals.css";

/**
 * When the root layout itself fails: no fonts, theme or providers are loaded,
 * so this page brings its own html/body and keeps to the global tokens.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background px-4 font-sans text-foreground antialiased">
        <title>Something went wrong | Open Poll</title>
        <div role="alert" className="w-full max-w-lg rounded-xl border border-border bg-card p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Open Poll didn&apos;t load</h1>
          <p className="mt-2 text-base text-muted-foreground">
            Something went wrong on our side. Try again in a moment.
          </p>
          {error.digest ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Error reference <span className="font-mono text-foreground">{error.digest}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="mt-6 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
