"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ChevronsUpDown,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  User,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { HOME_PATH } from "@/lib/routes";
import { useAuthStore } from "@/features/auth";
import { WorkspaceSwitcher } from "@/features/workspaces/components/WorkspaceSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activeNavHref, isStudioPath, MAIN_NAV, WORKSPACE_NAV, type NavLink } from "./nav";

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

const ALL_NAV = [...MAIN_NAV, ...WORKSPACE_NAV];

/**
 * Everything inside the creator sidebar: brand, workspace, the places (main
 * and workspace groups) and the account menu. Rendered by the desktop rail
 * (collapsible) and the phone drawer.
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

  const activeHref = activeNavHref(pathname, ALL_NAV);

  const itemClass = (active: boolean) =>
    cn(
      "group relative flex h-[38px] w-full items-center gap-2.5 rounded-lg border px-2.5 text-sm font-medium transition-colors duration-150",
      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
      active
        ? "border-border bg-card text-foreground shadow-xs"
        : "border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      collapsed && "w-[38px] justify-center px-0",
    );

  const renderLink = ({ href, label, Icon }: NavLink) => {
    const active = href === activeHref;
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        title={collapsed ? label : undefined}
        className={itemClass(active)}
      >
        <Icon className={cn("size-[18px] shrink-0", active && "text-accent-ink")} strokeWidth={1.8} aria-hidden="true" />
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </Link>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand + collapse */}
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <Link
          href={HOME_PATH}
          onClick={onNavigate}
          aria-label="Open Poll home"
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
      <div className={cn("shrink-0 px-3 pb-4", collapsed && "flex justify-center px-0")}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <nav aria-label="Main" className={cn("flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pt-2", collapsed && "items-center px-0")}>
        <div className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>{MAIN_NAV.map(renderLink)}</div>
        <div className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
          {collapsed ? (
            <span aria-hidden="true" className="mb-1 h-px w-6 bg-sidebar-border" />
          ) : (
            <span className="meta-label px-2.5 pb-1.5">Workspace</span>
          )}
          {WORKSPACE_NAV.map(renderLink)}
        </div>
      </nav>

      {/* Account */}
      <div className={cn("shrink-0 p-3", collapsed && "flex justify-center px-0")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors duration-150 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
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

/**
 * Desktop rail (md and up): 248px, collapses to 64px. In the builders it starts
 * collapsed to leave room for the slide; that choice is kept apart from the
 * one made on other pages.
 */
export default function Sidebar() {
  const studio = isStudioPath(usePathname());
  const [openOnPages, setOpenOnPages] = useState(true);
  const [openInStudio, setOpenInStudio] = useState(false);
  const open = studio ? openInStudio : openOnPages;
  const toggle = () => (studio ? setOpenInStudio : setOpenOnPages)((v) => !v);
  return (
    <motion.aside
      animate={{ width: open ? 248 : 64 }}
      transition={{ duration: 0.32, ease }}
      className="relative z-20 hidden shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block"
    >
      <SidebarContent collapsed={!open} onCollapse={toggle} />
    </motion.aside>
  );
}

/** Phone top bar (below md): brand and a menu button that opens the sidebar as a drawer. */
export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-md md:hidden">
        <Link href={HOME_PATH} aria-label="Open Poll home" className="flex items-center gap-2 rounded-md">
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
