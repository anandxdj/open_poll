"use client";

import { useState, type ReactNode } from "react";

/**
 * The slide's image for the live views: a plain `<img>` (an author-supplied
 * https address, so `next/image` would need an open proxy), no referrer sent,
 * not draggable (a drag must move the pin). `onFail` tells the view the
 * picture cannot be used; until then `fallback` replaces a failed image.
 */
export function PinImage({
  url,
  alt,
  className,
  fallback = null,
  onFail,
}: {
  url: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
  onFail?: () => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === url) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={className}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => {
        setFailedUrl(url);
        onFail?.();
      }}
    />
  );
}
