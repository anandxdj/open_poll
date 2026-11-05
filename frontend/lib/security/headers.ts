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

/**
 * Embed pages (W4-D) are meant to be framed by other sites, so the baseline's
 * `frame-ancestors 'self'` must not reach them: browsers enforce every CSP
 * header a response carries, so a second, looser one would not help. Their
 * CSP comes from the proxy instead (`lib/proxy/embeds.ts`), per deck: the
 * workspace's allowed sites, or `'self'` when the deck does not allow
 * embedding. Every other page keeps `frame-ancestors 'self'`.
 */
export const EMBED_PATH_PREFIX = "/embed";

/** CSP of an embed page: the baseline directives with the deck's `frame-ancestors`. */
export function embedCsp(frameAncestors: readonly string[]): string {
  return buildCsp({ ...CSP_DIRECTIVES, "frame-ancestors": frameAncestors.length ? [...frameAncestors] : ["'self'"] });
}

/**
 * Add-in panes (W4-D) are framed by Microsoft 365 (PowerPoint task pane,
 * Teams tabs) and opened by the Zoom client. Their frame-ancestors name those
 * hosts only; `'self'` stays for previews.
 */
export const MICROSOFT_FRAME_ANCESTORS = [
  "'self'",
  "https://*.office.com",
  "https://*.office365.com",
  "https://*.officeapps.live.com",
  "https://*.microsoft.com",
  "https://*.sharepoint.com",
  "https://*.cloud.microsoft",
  "https://teams.microsoft.com",
  "https://*.teams.microsoft.com",
  "https://*.skype.com",
];

/**
 * Zoom Apps load only pages that send the OWASP secure headers Zoom checks:
 * HSTS, nosniff, a CSP and a Referrer-Policy (Zoom Apps docs, "OWASP secure
 * headers"). The Zoom client opens the app itself, not in a frame of ours, so
 * frame-ancestors keeps it to this site and Zoom's own web client.
 */
export const ZOOM_HEADERS: HeaderRule["headers"] = [
  {
    key: "Content-Security-Policy",
    value: buildCsp({ ...CSP_DIRECTIVES, "frame-ancestors": ["'self'", "https://*.zoom.us", "https://*.zoom.com"] }),
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** Rules for next.config.ts `headers()`. Later rules override earlier ones per key. */
export function securityHeaders(): HeaderRule[] {
  return [
    // Everything but the embed pages, whose CSP the proxy sets per deck.
    { source: "/:path((?!embed(?:/|$)).*)", headers: BASELINE_HEADERS },
    { source: "/embed/:path*", headers: BASELINE_HEADERS.filter((header) => header.key !== "Content-Security-Policy") },
    {
      source: "/addins/:path((?!zoom(?:/|$)).*)",
      headers: [{ key: "Content-Security-Policy", value: buildCsp({ ...CSP_DIRECTIVES, "frame-ancestors": MICROSOFT_FRAME_ANCESTORS }) }],
    },
    { source: "/addins/zoom/:path*", headers: ZOOM_HEADERS },
    { source: "/addins/zoom", headers: ZOOM_HEADERS },
  ];
}
