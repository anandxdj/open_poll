"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PlusCircle, BarChart3 } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/polls", label: "My Polls", icon: LayoutDashboard },
  { href: "/create", label: "Create Poll", icon: PlusCircle },
  { href: "/analytics/demo", label: "Analytics", icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-72 border-r border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div className="flex h-full flex-col p-5">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Open Poll</p>
          <h1 className="mt-2 text-xl font-semibold text-zinc-100">Creator Dashboard</h1>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "border-yellow-500/40 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 text-yellow-300"
                    : "border-transparent bg-slate-900/70 text-zinc-300 hover:border-zinc-700 hover:bg-slate-900 hover:text-zinc-100"
                )}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-lg border border-zinc-800 bg-slate-900/70 p-4">
          <p className="text-xs text-zinc-400">Using mock identity</p>
          <p className="mt-1 text-xs text-orange-300/80">mock-creator-id-123</p>
        </div>
      </div>
    </aside>
  );
}
