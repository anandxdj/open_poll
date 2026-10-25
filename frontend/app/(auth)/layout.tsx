import type { Metadata } from "next";

import { NO_INDEX } from "@/lib/seo/site";

// Password reset and email verification are one-off links; login and signup opt back in.
export const metadata: Metadata = { robots: NO_INDEX };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
