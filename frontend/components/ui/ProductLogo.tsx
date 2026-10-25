import { cn } from "@/lib/utils";

interface ProductLogoProps {
  className?: string;
  size?: number;
  /** Hide from assistive tech when the wordmark next to it already says "Open Poll". */
  decorative?: boolean;
}

/**
 * The Open Poll mark (rising bars inside a "j") as inline SVG, so it takes the
 * brand orange of the active theme instead of a fixed raster colour.
 */
export function ProductLogo({ className, size = 44, decorative = false }: ProductLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="87 105 280 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      style={{ color: "var(--brand)" }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Open Poll" })}
    >
      <circle cx="292" cy="145" r="21" fill="currentColor" />
      <rect x="178" y="254" width="34" height="74" rx="14" fill="currentColor" />
      <rect x="227" y="215" width="34" height="113" rx="14" fill="currentColor" />
      <rect x="274.5" y="180" width="35" height="80" rx="13" fill="currentColor" />
      <path
        d="M292 240V294C292 324 268 347 232 347C197 347 170 333 156 314"
        stroke="currentColor"
        strokeWidth="35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default ProductLogo;
