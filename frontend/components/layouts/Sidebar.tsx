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
  User,
  LogOut,
  Moon,
  Sun,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";
import { useTheme } from "next-themes";
import { useAuthStore } from "@/features/auth";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ease = [0.32, 0.72, 0, 1] as const;

// View Transition logic for cinematic theme switching
function applyWithTransition(
  origin: { x: number; y: number },
  apply: () => void,
) {
  if (!document.startViewTransition) {
    apply();
    return;
  }
  
  // Fallback to center if coordinates are missing or zero (keyboard activation)
  const x = origin.x || window.innerWidth / 2;
  const y = origin.y || window.innerHeight / 2;

  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  document.documentElement.style.setProperty("--vt-x", `${x}px`);
  document.documentElement.style.setProperty("--vt-y", `${y}px`);
  document.documentElement.style.setProperty("--vt-r", `${endRadius}px`);
  document.startViewTransition(apply);
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(true);
  const { open: openCreatePollModal } = useCreatePollModal();
  const { setTheme, resolvedTheme } = useTheme();
  const { user, logout } = useAuthStore();

  const navItems = [
    { href: "/polls", label: "Dashboard", Icon: LayoutDashboard },
    { href: "/create", label: "Create Poll", Icon: ListPlus },
    { href: "/analytics", label: "Analytics", Icon: BarChart2 },
  ];

  const toggleTheme = (e: React.MouseEvent) => {
    applyWithTransition({ x: e.clientX, y: e.clientY }, () => {
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    });
  };
  
  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  const [imgError, setImgError] = useState(false);

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
              <div className="size-7 flex items-center justify-center">
                <ProductLogo size={36} />
              </div>
              <div>
                <p className="text-xs font-bold text-sidebar-foreground leading-none">Open Poll</p>
               
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!navOpen && (
          <div className="mx-auto size-7 flex items-center justify-center">
            <ProductLogo size={36} />
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

      {/* User profile dropdown at bottom */}
      <div className="mt-auto p-2 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-xl p-2 transition-colors duration-200 hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground",
                !navOpen && "justify-center px-0"
              )}
            >
              <div className="size-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 overflow-hidden">
                {user?.picture && !imgError ? (
                  <img 
                    src={user.picture} 
                    alt="" 
                    className="size-full object-cover" 
                    onError={() => setImgError(true)}
                  />
                ) : (
                  getInitials(user?.name || "User")
                )}
              </div>
              {navOpen && (
                <div className="flex flex-1 items-center justify-between min-w-0">
                  <div className="text-left min-w-0">
                    <p className="text-[11px] font-bold leading-none truncate">{user?.name || "User"}</p>
                    <p className="text-[9px] text-sidebar-foreground/40 leading-none mt-1 truncate">{user?.email || "Account"}</p>
                  </div>
                  <ChevronUp className="size-3 opacity-30" />
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={navOpen ? 4 : 12}
            className="w-56 rounded-2xl border-sidebar-border bg-sidebar p-1 shadow-2xl"
          >
            <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
              Account
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link
                href="/settings#profile"
                className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-sidebar-foreground/70 transition-colors focus:bg-primary/10 focus:text-primary"
              >
                <User className="size-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/settings"
                className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-sidebar-foreground/70 transition-colors focus:bg-primary/10 focus:text-primary"
              >
                <Settings className="size-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-sidebar-border" />
            <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
              Preferences
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={toggleTheme}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-sidebar-foreground/70 transition-colors focus:bg-primary/10 focus:text-primary group/theme"
            >
              <div className="relative size-4">
                <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute inset-0 size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </div>
              <span>Theme</span>
              <span className="ml-auto text-[10px] font-bold uppercase text-primary/40 group-hover/theme:text-primary transition-colors">
                {resolvedTheme === "dark" ? "Dark" : "Light"}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-sidebar-border" />
            <DropdownMenuItem 
              onClick={handleLogout}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-red-500 transition-colors focus:bg-red-500/10 focus:text-red-500"
            >
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.aside>
  );
}
