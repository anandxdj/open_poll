import { Suspense } from "react";

import { LibraryView } from "@/features/library/components/LibraryView";

// The unified library: polls and presentation decks in one list. The URL stays
// /polls (bookmarks, sign-in redirects); filters are its query string.
export default function LibraryPage() {
  return (
    // LibraryView reads the filters with useSearchParams, so the static shell
    // renders this fallback until the client takes over.
    <Suspense fallback={<LibraryFallback />}>
      <LibraryView />
    </Suspense>
  );
}

function LibraryFallback() {
  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b border-border bg-background/95 px-4 backdrop-blur-xl md:px-6">
        <h1 className="text-sm font-semibold text-foreground/90">Library</h1>
      </header>
      <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 sm:grid-cols-2 md:px-6 xl:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-52 animate-pulse rounded-[2rem] border border-border bg-secondary/30" />
        ))}
      </div>
    </>
  );
}
