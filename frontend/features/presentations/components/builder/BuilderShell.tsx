import type { ReactNode } from "react";

/**
 * Page frame of the deck builder, a studio rather than a page: the header bar
 * across the top, the slide rail on the left (on top on small screens), the
 * stage (the slide and its notes) on graph paper in the middle, and the
 * inspector as a panel on the right from `xl`. Below `xl` the inspector sits
 * under the stage and both scroll together.
 */
export function BuilderShell({
  header,
  rail,
  stage,
  children,
}: {
  header: ReactNode;
  rail: ReactNode;
  stage: ReactNode;
  /** The inspector. */
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {header}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {rail}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:overflow-hidden">
          <section aria-label="Slide preview" className="relative min-w-0 xl:overflow-y-auto">
            <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
            <div className="relative px-4 py-6 sm:px-8 lg:py-8">{stage}</div>
          </section>
          <aside
            aria-label="Slide settings"
            className="px-4 pb-10 sm:px-8 xl:overflow-y-auto xl:border-l xl:border-border xl:bg-background xl:p-0"
          >
            <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-border bg-card xl:max-w-none xl:rounded-none xl:border-0 xl:bg-transparent">
              {children}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
