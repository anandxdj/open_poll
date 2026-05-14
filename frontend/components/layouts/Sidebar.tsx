"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  ListPlus,
  BarChart2,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";

const ease = [0.32, 0.72, 0, 1] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(true);
  const { open: openCreatePollModal } = useCreatePollModal();

  const navItems = [
    { href: "/polls", label: "Dashboard", Icon: LayoutDashboard },
    { href: "/create", label: "Create Poll", Icon: ListPlus },
    { href: "/analytics", label: "Analytics", Icon: BarChart2 },
    { href: "/settings", label: "Settings", Icon: Settings },
  ];

  return (
    <motion.aside
      animate={{ width: navOpen ? 200 : 52 }}
      transition={{ duration: 0.38, ease }}
      className="relative shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar overflow-hidden z-20"
    >
      {/* Branding + toggle */}
      <div className="flex h-14 items-center justify-between px-3 shrink-0 border-b border-sidebar-border">
        <AnimatePresence>
          {navOpen && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-2"
            >
              <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <Zap className="size-3.5 text-primary-foreground fill-primary-foreground" />
              </div>
              <div>
                <p className="text-xs font-bold text-sidebar-foreground leading-none">Open Poll</p>
                <p className="text-[9px] font-medium text-sidebar-foreground/40 uppercase tracking-widest leading-none mt-0.5">App</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!navOpen && (
          <div className="mx-auto size-7 rounded-lg bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground fill-primary-foreground" />
          </div>
        )}

        {navOpen && (
          <button
            onClick={() => setNavOpen(false)}
            className="shrink-0 flex size-7 items-center justify-center rounded-lg text-sidebar-foreground/30 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
          >
            <PanelLeftClose className="size-3.5" />
          </button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {!navOpen && (
        <button
          onClick={() => setNavOpen(true)}
          className="mx-auto mt-2 flex size-7 items-center justify-center rounded-lg text-sidebar-foreground/30 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
        >
          <PanelLeftOpen className="size-3.5" />
        </button>
      )}

      <div className="h-px bg-sidebar-border mx-3 mt-3 mb-3 shrink-0" />

      {/* Nav links */}
      <nav className={cn("flex-1 space-y-0.5 px-2", !navOpen && "flex flex-col items-center px-0 space-y-1.5")}>
        {navItems.map(({ href, label, Icon }) => {
          const isActive = pathname?.startsWith(href);
          const baseClass = cn(
            "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors duration-200",
            isActive
              ? "bg-primary/15 text-primary"
              : "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            !navOpen && "w-9 justify-center px-0"
          );

          if (href === "/create") {
            return (
              <button
                key={href}
                type="button"
                onClick={() => openCreatePollModal()}
                className={cn(baseClass, "w-full text-left")}
                title={!navOpen ? label : undefined}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                {navOpen && <span className={cn("text-xs font-medium", isActive && "font-semibold")}>{label}</span>}
              </button>
            );
          }

          return (
            <Link
              key={href}
              href={href}
              className={baseClass}
              title={!navOpen ? label : ""}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.8} />
              {navOpen && <span className={cn("text-xs font-medium", isActive && "font-semibold")}>{label}</span>}
            </Link>
          );
        })}
      </nav>
    </motion.aside>
  );
}
