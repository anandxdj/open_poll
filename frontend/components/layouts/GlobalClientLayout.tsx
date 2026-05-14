"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/layouts/Sidebar";
import { CreatePollModalProvider } from "@/features/polls/components/CreatePollModalProvider";

export default function GlobalClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Exclude landing page, test route and public poll answering route natively
  if (pathname === "/" || pathname?.startsWith("/test") || pathname?.startsWith("/p/")) {
    return <>{children}</>;
  }

  return (
    <CreatePollModalProvider>
      <div className="fixed inset-0 flex min-h-0 bg-background text-foreground overflow-hidden selection:bg-primary selection:text-primary-foreground">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </CreatePollModalProvider>
  );
}
