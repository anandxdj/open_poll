import { getSiteUrl } from "@/lib/seo/site";

/**
 * Which hosts are the product itself and which are a workspace's custom
 * domain (W4-E). Shared by the proxy step and the pages that brand themselves
 * on a custom domain.
 */

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;

const hostnameOf = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, "");

/** Custom domains are served only when the deployment says so (`NEXT_PUBLIC_CUSTOM_DOMAINS=on`). */
export const customDomainsOn = () => process.env.NEXT_PUBLIC_CUSTOM_DOMAINS === "on";

/**
 * The site's own hosts: NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_PRIMARY_HOSTS (comma list), local and
 * Vercel preview hosts.
 */
export function isPrimaryHost(host: string, extra: string | undefined = process.env.NEXT_PUBLIC_PRIMARY_HOSTS): boolean {
  const hostname = hostnameOf(host);
  if (!hostname || LOCAL.test(hostname) || hostname.endsWith(".vercel.app")) return true;
  const primary = new Set([getSiteUrl().hostname.toLowerCase(), ...(extra ?? "").split(",").map(hostnameOf).filter(Boolean)]);
  return primary.has(hostname);
}

export type CustomDomainAction = "join" | "pass" | "redirect";

/**
 * What a custom domain does with a path: `/` is the branded join page,
 * participant pages (join, live, results, embeds, public polls) and assets
 * pass, anything else goes to the same path on the main site.
 */
export function customDomainAction(pathname: string): CustomDomainAction {
  if (pathname === "/") return "join";
  if (
    pathname === "/live" ||
    pathname.startsWith("/live/") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/embed/") ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/_next/") ||
    /\.[a-z0-9]{2,5}$/i.test(pathname)
  ) {
    return "pass";
  }
  return "redirect";
}
