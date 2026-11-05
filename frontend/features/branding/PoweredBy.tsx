"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useCustomDomain } from "@/features/domains/hooks/useCustomDomain";
import { cn } from "@/lib/utils";

/**
 * The footer of pages people open from a shared link: where the page comes
 * from, and a way to make one. Hidden on a white-label workspace's own
 * custom domain (W4-E).
 */
export function PoweredBy({ note, cta, className }: { note: string; cta: string; className: string }) {
  const domain = useCustomDomain();
  if (domain?.whiteLabel) return null;
  return (
    <footer className="border-t border-border">
      <div className={cn(className, "flex flex-wrap items-center justify-between gap-3 py-6")}>
        <p className="text-sm text-muted-foreground">{note}</p>
        <Link href="/signup" className={cn(buttonVariants({ variant: "outline" }), "rounded-full bg-card")}>
          {cta}
        </Link>
      </div>
    </footer>
  );
}
