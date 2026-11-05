/**
 * The public contact address for support, privacy and legal questions. It appears on the Terms and
 * Privacy pages, in the landing footer and in the app's account menu. NEXT_PUBLIC_SUPPORT_EMAIL
 * overrides it at build time.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "darkjargon739@gmail.com";

export const supportMailto = (subject?: string) =>
  `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
