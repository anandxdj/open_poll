import DashboardShell from "@/components/layouts/DashboardShell";

// Only routes in this group get the creator chrome (sidebar + create modals).
// Landing, auth, live, public poll and presentation host routes sit outside it.
export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <DashboardShell>{children}</DashboardShell>;
}
