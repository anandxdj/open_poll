import { BarChart3, House, LayoutGrid, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";

import { HOME_PATH } from "@/lib/routes";

export interface NavLink {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Path prefixes that belong to this link (the page itself and the pages opened from it). */
  match: readonly string[];
}

/** Places, not actions: creating lives in page headers (Home, Library). */
export const MAIN_NAV: readonly NavLink[] = [
  { href: HOME_PATH, label: "Home", Icon: House, match: [HOME_PATH] },
  // Builders and a deck's session history are opened from the library.
  { href: "/polls", label: "Library", Icon: LayoutGrid, match: ["/polls", "/presentations", "/create", "/presentation"] },
  { href: "/analytics", label: "Analytics", Icon: BarChart3, match: ["/analytics"] },
];

export const WORKSPACE_NAV: readonly NavLink[] = [
  { href: "/settings/members", label: "Members", Icon: Users, match: ["/settings/members"] },
  { href: "/settings", label: "Settings", Icon: SlidersHorizontal, match: ["/settings"] },
];

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * The link a path belongs to: the one with the longest matching prefix, so
 * /settings/members marks Members and not Settings. Null when none matches.
 */
export function activeNavHref(pathname: string | null, links: readonly NavLink[]): string | null {
  if (!pathname) return null;
  let best: { href: string; length: number } | null = null;
  for (const link of links) {
    for (const prefix of link.match) {
      if (matches(pathname, prefix) && (!best || prefix.length > best.length)) best = { href: link.href, length: prefix.length };
    }
  }
  return best?.href ?? null;
}
