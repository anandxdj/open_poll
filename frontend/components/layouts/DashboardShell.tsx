"use client";

import Sidebar, { MobileTopBar } from "@/components/layouts/Sidebar";
import { CreatePollModalProvider } from "@/features/polls/components/CreatePollModalProvider";
import { CreatePresentationModalProvider } from "@/features/presentations/components/CreatePresentationModalProvider";

/**
 * Creator chrome: the sidebar rail beside a scrolling main area (md and up), a
 * top bar with a drawer on phones, plus the create-modal providers.
 */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <CreatePollModalProvider>
      <CreatePresentationModalProvider>
        <div className="fixed inset-0 flex min-h-0 bg-background text-foreground overflow-hidden selection:bg-primary selection:text-primary-foreground">
          <Sidebar />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MobileTopBar />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
          </div>
        </div>
      </CreatePresentationModalProvider>
    </CreatePollModalProvider>
  );
}
