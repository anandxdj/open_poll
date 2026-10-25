import type { ReactNode } from "react";

/**
 * Page frame of the deck builder, a studio rather than a page: the header bar
 * across the top, the slide rail on the left (on top on small screens), and
 * the editor on graph paper, centred and scrolling on its own.
 */
export function BuilderShell({ header, rail, children }: { header: ReactNode; rail: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {header}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {rail}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
          <div className="relative mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
