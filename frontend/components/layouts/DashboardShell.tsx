"use client";

import Sidebar from "@/components/layouts/Sidebar";
import { CreatePollModalProvider } from "@/features/polls/components/CreatePollModalProvider";
import { CreatePresentationModalProvider } from "@/features/presentations/components/CreatePresentationModalProvider";

/** Creator chrome: Kinetic Sidebar beside a scrolling main area, plus the create-modal providers. */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <CreatePollModalProvider>
      <CreatePresentationModalProvider>
        <div className="fixed inset-0 flex min-h-0 bg-background text-foreground overflow-hidden selection:bg-primary selection:text-primary-foreground">
          <Sidebar />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
        </div>
      </CreatePresentationModalProvider>
    </CreatePollModalProvider>
  );
}
