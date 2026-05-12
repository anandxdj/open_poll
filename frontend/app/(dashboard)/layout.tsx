import Sidebar from "@/components/layouts/Sidebar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-slate-950 to-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <Sidebar />
        <section className="flex-1 p-6 md:p-8">
          <div className="min-h-full rounded-2xl border border-zinc-800/80 bg-slate-950/40 p-4 md:p-6">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
