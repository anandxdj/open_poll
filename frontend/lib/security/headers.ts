// Frontend security headers, applied to every page by next.config.ts `headers()`.
// The API sets its own headers (helmet) — this only covers what Next serves.

export type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

/**
 * Origin of the object-storage public URL (backend `S3_PUBLIC_URL`, given to
 * the frontend build as `NEXT_PUBLIC_STORAGE_PUBLIC_URL`), so uploaded images
 * load even from a plain-http bucket in development. Empty when unset.
 */
export function storageOrigins(publicUrl: string | undefined): string[] {
  if (!publicUrl) return [];
  try {
    const { protocol, origin } = new URL(publicUrl);
    return protocol === "https:" || protocol === "http:" ? [origin] : [];
  } catch {
    return [];
  }
}

/**
 * Content-Security-Policy directives, one line per directive. Only directives
 * listed here are enforced, so a feature that needs a new source (embedded
 * video frames, storage images, …) adds or extends its directive here.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  // Clickjacking protection: only this origin may frame the app.
  "frame-ancestors": ["'self'"],
  // Video slides embed only the privacy-enhanced YouTube and the Vimeo player.
  "frame-src": ["'self'", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
  // Image slides show uploads (storage) or pasted https links; data:/blob:
  // cover inline icons and local previews.
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https:",
    ...storageOrigins(process.env.NEXT_PUBLIC_STORAGE_PUBLIC_URL),
  ],
};

export function buildCsp(directives: Record<string, string[]> = CSP_DIRECTIVES): string {
  return Object.entries(directives)
    .filter(([, sources]) => sources.length > 0)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export const BASELINE_HEADERS: HeaderRule["headers"] = [
  { key: "Content-Security-Policy", value: buildCsp() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** Rules for next.config.ts `headers()`. Later rules override earlier ones per key. */
export function securityHeaders(): HeaderRule[] {
  return [{ source: "/:path*", headers: BASELINE_HEADERS }];
}
