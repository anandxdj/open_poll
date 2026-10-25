import type { Metadata } from "next";
import DashboardShell from "@/components/layouts/DashboardShell";
import { NO_INDEX } from "@/lib/seo/site";

// The signed-in app: nothing here belongs in search results.
export const metadata: Metadata = { robots: NO_INDEX };

// Only routes in this group get the creator chrome (sidebar + create modals).
// Landing, auth, live, public poll and presentation host routes sit outside it.
export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <DashboardShell>{children}</DashboardShell>;
}
