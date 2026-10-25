"use client";

import { Badge } from "@/components/ui/badge";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

/**
 * Graph-paper frame for the small product illustrations (capabilities bento,
 * how-it-works steps): a "Sample" badge and one image to assistive tech.
 *
 * The drawing inside renders after mount only: the server cannot know about
 * reduced motion, and an illustration's first frame differs with it. `ref`
 * stays on the frame so `useSeen` can watch it before the drawing exists.
 */
export function ArtFrame({
  ref,
  label,
  size = "lg",
  className,
  children,
}: {
  ref: React.Ref<HTMLDivElement>;
  label: string;
  /** `lg` 256px for featured cells, `sm` 176px for compact cells and steps. */
  size?: "lg" | "sm";
  className?: string;
  children: React.ReactNode;
}) {
  const mounted = useMounted();
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-background",
        size === "lg" ? "h-64" : "h-44",
        className,
      )}
    >
      <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
      <Badge variant="outline" className="absolute right-2.5 top-2.5 z-10 bg-background">
        Sample
      </Badge>
      <div
        className={cn(
          "relative flex h-full items-center justify-center",
          size === "lg" ? "px-5 pb-4 pt-11" : "px-3.5 pb-3 pt-10",
        )}
      >
        {mounted ? children : null}
      </div>
    </div>
  );
}

/** The white sheet an illustration's content sits on. */
export const artSheet = "w-full rounded-xl border border-border bg-card shadow-[0_16px_32px_-20px_rgb(23_23_23/0.3)]";
