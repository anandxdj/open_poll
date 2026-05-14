"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Zap } from "lucide-react";

const crumbMap: Record<string, string> = {
  polls: "Dashboard",
  create: "Create Poll",
  analytics: "Analytics",
};

function getBreadcrumbs(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((seg, i) => {
    const label = crumbMap[seg] ?? seg;
    const href = "/" + segments.slice(0, i + 1).join("/");
    return { label, href };
  });
}

export default function Navbar() {
  const pathname = usePathname();
  const crumbs = getBreadcrumbs(pathname);

  return (
    <header className="h-14 shrink-0 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-xl px-6 z-20">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <Zap className="size-3.5 text-primary/60" />
        </Link>
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-1.5">
            <ChevronRight className="size-3 text-muted-foreground/30" />
            {i === crumbs.length - 1 ? (
              <span className="font-medium text-foreground/70">{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Status indicator */}
      <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          System Online
        </span>
      </div>
    </header>
  );
}
