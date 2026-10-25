import { cn } from "@/lib/utils";

/**
 * Graph-paper panel that product illustrations sit on, the same hairline grid
 * as the hero, so every sample reads as something plotted rather than a
 * floating card. Purely a backdrop: the illustration inside carries the label.
 */
export function PlotPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-background", className)}>
      <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
      <div className="relative px-4 py-8 sm:px-10 sm:py-12">{children}</div>
    </div>
  );
}
