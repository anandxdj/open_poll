"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import Sidebar from "@/components/layouts/Sidebar";
import { CreatePollModalProvider } from "@/features/polls/components/CreatePollModalProvider";
import { useAuthStore } from "@/features/auth/store/useAuthStore";

export default function GlobalClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Exclude landing page, auth pages, test route and public poll answering route natively
  if (
    pathname === "/" || 
    pathname === "/login" || 
    pathname === "/signup" ||
    pathname === "/auth/callback" ||
    pathname?.startsWith("/test") || 
    pathname?.startsWith("/p/")
  ) {
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
