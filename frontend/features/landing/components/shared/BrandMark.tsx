import Link from "next/link";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { cn } from "@/lib/utils";

/** Logo and wordmark, linked home. Shared by the landing header/footer and the sign-in pages. */
export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <Link
      href="/"
      aria-label="Open Poll home"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md text-base font-semibold tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        className,
      )}
    >
      {/* The wordmark carries the name; the mark is decoration. */}
      <ProductLogo size={size} decorative />
      Open Poll
    </Link>
  );
}
