import Link from "next/link";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { cn } from "@/lib/utils";

/** Logo and wordmark, linked home. Shared by the landing header/footer and the auth pages. */
export function BrandMark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <Link
      href="/"
      aria-label="Open Poll home"
      className={cn("mk-focus group inline-flex items-center gap-2.5 rounded-xl", className)}
    >
      {/* The wordmark carries the name; the logo image is decoration. */}
      <span aria-hidden="true" className="flex items-center justify-center" style={{ width: size, height: size }}>
        <ProductLogo size={size} className="transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105" />
      </span>
      <span className="text-lg font-bold tracking-tight text-foreground">Open Poll</span>
    </Link>
  );
}
