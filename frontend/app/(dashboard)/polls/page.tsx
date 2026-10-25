import { Suspense } from "react";

import { LibraryCardSkeleton, LibraryView } from "@/features/library/components/LibraryView";

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
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <h1 className="text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">Library</h1>
      <div className="mt-28 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <LibraryCardSkeleton key={key} />
        ))}
      </div>
    </div>
  );
}
