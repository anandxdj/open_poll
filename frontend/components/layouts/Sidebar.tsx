"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  BarChart2,
  ChevronsUpDown,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Presentation,
  Settings,
  Sun,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";
import { useCreatePresentationModal } from "@/features/presentations/components/CreatePresentationModalProvider";
import { useAuthStore } from "@/features/auth";
import { WorkspaceSwitcher } from "@/features/workspaces/components/WorkspaceSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ease = [0.32, 0.72, 0, 1] as const;

// View Transition logic for cinematic theme switching
function applyWithTransition(origin: { x: number; y: number }, apply: () => void) {
  if (!document.startViewTransition) {
    apply();
    return;
  }

  // Fallback to center if coordinates are missing or zero (keyboard activation)
  const x = origin.x || window.innerWidth / 2;
  const y = origin.y || window.innerHeight / 2;

  const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  document.documentElement.style.setProperty("--vt-x", `${x}px`);
  document.documentElement.style.setProperty("--vt-y", `${y}px`);
  document.documentElement.style.setProperty("--vt-r", `${endRadius}px`);
  document.startViewTransition(apply);
}

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);

type NavItem =
  | { label: string; Icon: LucideIcon; href: string }
  | { label: string; Icon: LucideIcon; action: "poll" | "deck" };

/** "New poll" and "New deck" open the create modals rather than a page. */
const NAV: NavItem[] = [
  { href: "/polls", label: "Library", Icon: LayoutGrid },
  { action: "poll", label: "New poll", Icon: Plus },
  { action: "deck", label: "New deck", Icon: Presentation },
  { href: "/analytics", label: "Analytics", Icon: BarChart2 },
];

/**
 * Everything inside the creator sidebar: brand, workspace, navigation and the
 * account menu. Rendered by the desktop rail (collapsible) and the phone drawer.
 */
function SidebarContent({
  collapsed = false,
  onCollapse,
  onNavigate,
}: {
  collapsed?: boolean;
  /** Desktop only: toggles the rail. */
  onCollapse?: () => void;
  /** Phone drawer: closes it after a choice. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { open: openCreatePollModal } = useCreatePollModal();
  const { open: openCreatePresentationModal } = useCreatePresentationModal();
  const { setTheme, resolvedTheme } = useTheme();
  const { user, logout } = useAuthStore();
  const [imgError, setImgError] = useState(false);

  const toggleTheme = (e: React.MouseEvent) => {
    applyWithTransition({ x: e.clientX, y: e.clientY }, () => {
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    });
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const itemClass = (active: boolean) =>
    cn(
      "group relative flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150",
      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
      active
        ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.06)] ring-1 ring-border"
        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      collapsed && "w-9 justify-center px-0",
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand + collapse */}
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <Link
          href="/polls"
          onClick={onNavigate}
          aria-label="Open Poll library"
          className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ProductLogo size={26} decorative />
          {!collapsed ? <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">Open Poll</span> : null}
        </Link>
        {onCollapse && !collapsed ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        ) : null}
      </div>

      {onCollapse && collapsed ? (
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Expand sidebar"
          className="mx-auto mb-1 flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      ) : null}

      {/* Current workspace */}
      <div className={cn("shrink-0 px-3 pb-3", collapsed && "flex justify-center px-0")}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <nav aria-label="Main" className={cn("flex-1 space-y-1 border-t border-sidebar-border px-3 pt-3", collapsed && "flex flex-col items-center px-0")}>
        {NAV.map((item) => {
          const { label, Icon } = item;
          const active = "href" in item && Boolean(pathname?.startsWith(item.href));
          const content = (
            <>
              <Icon className={cn("size-[18px] shrink-0", active ? "text-accent-ink" : "")} strokeWidth={1.8} aria-hidden="true" />
              {!collapsed ? <span className="truncate">{label}</span> : null}
            </>
          );
          if ("href" in item) {
            return (
              <Link
                key={label}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
                title={collapsed ? label : undefined}
                className={itemClass(active)}
              >
                {content}
              </Link>
            );
          }
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                onNavigate?.();
                if (item.action === "poll") openCreatePollModal();
                else openCreatePresentationModal();
              }}
              aria-label={collapsed ? label : undefined}
              title={collapsed ? label : undefined}
              className={itemClass(false)}
            >
              {content}
            </button>
          );
        })}
      </nav>

      {/* Account */}
      <div className={cn("shrink-0 border-t border-sidebar-border p-3", collapsed && "flex justify-center px-0")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors duration-150 hover:bg-sidebar-accent",
                collapsed && "w-auto",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary font-mono text-xs font-medium text-foreground">
                {user?.picture && !imgError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.picture} alt="" className="size-full object-cover" onError={() => setImgError(true)} />
                ) : (
                  initials(user?.name || "User")
                )}
              </span>
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{user?.name || "Your account"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{user?.email || "Account"}</span>
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} sideOffset={8} className="w-60 p-1.5">
            <DropdownMenuItem asChild>
              <Link href="/settings/profile" onClick={onNavigate} className="cursor-pointer">
                <User /> Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" onClick={onNavigate} className="cursor-pointer">
                <Settings /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer">
              {resolvedTheme === "dark" ? <Moon /> : <Sun />}
              Theme
              <span className="ml-auto text-xs text-muted-foreground">{resolvedTheme === "dark" ? "Dark" : "Light"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void handleLogout()} className="cursor-pointer">
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Desktop rail (md and up): 240px, collapses to 60px. */
export default function Sidebar() {
  const [open, setOpen] = useState(true);
  return (
    <motion.aside
      animate={{ width: open ? 240 : 60 }}
      transition={{ duration: 0.32, ease }}
      className="relative z-20 hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block"
    >
      <SidebarContent collapsed={!open} onCollapse={() => setOpen((v) => !v)} />
    </motion.aside>
  );
}

/** Phone top bar (below md): brand and a menu button that opens the sidebar as a drawer. */
export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-md md:hidden">
        <Link href="/polls" aria-label="Open Poll library" className="flex items-center gap-2 rounded-md">
          <ProductLogo size={24} decorative />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Open Poll</span>
        </Link>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="Open menu"
            className="flex size-10 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent"
          >
            <Menu className="size-5" />
          </button>
        </DialogPrimitive.Trigger>
      </header>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left md:hidden"
        >
          <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label="Close menu"
              className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </DialogPrimitive.Close>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
