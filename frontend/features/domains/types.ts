import type { ThemeTokens } from "@/features/themes/types";

/** API shapes of `/api/workspaces/:id/domains` and `/api/public/domains/resolve` (backend `modules/domains`). */

export interface CustomDomain {
  id: string;
  hostname: string;
  status: "pending" | "active" | "failed";
  records: { type: "TXT" | "CNAME"; host: string; value: string; found: boolean }[];
  checkedAt: string | null;
  error: string | null;
  activatedAt: string | null;
  url: string;
}

export interface DomainsOverview {
  cnameTarget: string;
  domains: CustomDomain[];
}

/** What an active custom hostname serves. */
export interface ResolvedDomain {
  hostname: string;
  workspace: { id: string; name: string };
  whiteLabel: boolean;
  theme: ThemeTokens | null;
}
