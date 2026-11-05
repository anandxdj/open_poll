import type { ReactNode } from "react";
import { PoweredBy } from "@/features/branding/PoweredBy";
import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";

const widths = { narrow: "max-w-lg", wide: "max-w-4xl" } as const;

/**
 * Pages people open from a shared link (a poll, shared results, their own
 * results): a brand bar naming the page, one column, and a footer that says
 * where the page comes from with a way to make one (PoweredBy, hidden on a
 * white-label custom domain).
 */
export function PublicPageShell({
  label,
  width = "narrow",
  footer,
  children,
}: {
  /** What this page is, shown at the right of the brand bar. */
  label: string;
  width?: keyof typeof widths;
  footer?: { note: string; cta: string };
  children: ReactNode;
}) {
  const column = cn("mx-auto w-full px-4", widths[width], width === "wide" && "md:px-6");
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className={cn(column, "flex h-14 items-center justify-between gap-4 sm:h-16")}>
          <BrandMark size={24} />
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
      </header>
      <main className={cn(column, "flex-1 pb-16 pt-8 md:pt-12")}>{children}</main>
      {footer ? <PoweredBy note={footer.note} cta={footer.cta} className={column} /> : null}
    </div>
  );
}
