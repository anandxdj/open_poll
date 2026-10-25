"use client";

import { useState, type ReactNode } from "react";

/**
 * An author-supplied image from storage or any https host. `next/image` would
 * need an open `remotePatterns` proxy for arbitrary hosts, so this is a plain
 * `<img>`; the CSP `img-src` bounds where it may load from. No referrer is
 * sent to third-party hosts. Renders `fallback` when the image fails to load.
 */
export function RemoteImage({
  src,
  alt,
  className,
  fallback = null,
}: {
  src: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  );
}
