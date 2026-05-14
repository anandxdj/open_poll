"use client";

// The overall global structure (Sidebar + main overflow) is now handled by GlobalClientLayout
export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
