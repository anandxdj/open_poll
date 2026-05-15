"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
interface ProductLogoProps {
  className?: string;
  size?: number;
}

export function ProductLogo({ className, size = 44 }: ProductLogoProps) {
  return (
    <Image
      src="/logo-openpoll.png"
      alt="Open Poll Logo"
      width={size}
      height={size}
      className={cn("object-contain", className)}
      priority
    />
  );
}

export default ProductLogo;