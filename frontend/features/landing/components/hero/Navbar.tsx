"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, LogOut, Menu, Settings, User, X } from "lucide-react";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";
import { BrandMark } from "../shared/BrandMark";
import { NAV_LINKS } from "../shared/nav-links";
import { container, linkButton, pill } from "../shared/styles";

const ease = [0.32, 0.72, 0, 1] as const;

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const menuItem = "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const mounted = useMounted();
  const { user, isAuthenticated, logout, checkAuth } = useAuthStore();
  // The persisted store can already say "signed in" on the first client render;
  // wait for mount so the header matches the server HTML.
  const authed = mounted && isAuthenticated;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    void checkAuth();
    return () => window.removeEventListener("scroll", onScroll);
  }, [checkAuth]);

  const closeMenu = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeMenu]);

  const solid = scrolled || open;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color] duration-200",
        solid ? "border-border bg-background/80 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className={cn(container, "flex h-16 items-center gap-8")}>
        <BrandMark />

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch className="size-10 rounded-full lg:size-9" />

          {/* Desktop actions */}
          <div className="hidden items-center gap-2 lg:flex">
            <Link href="/live" className={cn(linkButton({ variant: "ghost", size: "sm" }), pill, "px-3.5")}>
              Join a session
            </Link>
            {authed ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Account menu"
                      className="flex size-9 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {user?.picture && !imgError ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={user.picture}
                          alt=""
                          className="size-full object-cover"
                          onError={() => setImgError(true)}
                        />
                      ) : (
                        initials(user?.name || "User")
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={10} className="w-60 p-1.5">
                    <div className="mb-1 border-b border-border px-2.5 pb-3 pt-2">
                      <p className="truncate text-sm font-semibold text-foreground">{user?.name || "Your account"}</p>
                      {user?.email ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p> : null}
                    </div>
                    <DropdownMenuItem asChild>
                      <Link href="/polls" className={menuItem}>
                        <LayoutDashboard className="size-4" aria-hidden="true" />
                        Dashboard
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/settings#profile" className={menuItem}>
                        <User className="size-4" aria-hidden="true" />
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/settings" className={menuItem}>
                        <Settings className="size-4" aria-hidden="true" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1" />
                    <DropdownMenuItem
                      onClick={() => void logout()}
                      className={cn(menuItem, "text-destructive focus:bg-destructive/10 focus:text-destructive")}
                    >
                      <LogOut className="size-4" aria-hidden="true" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Link href="/polls" className={cn(linkButton({ size: "sm" }), pill, "px-4")}>
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className={cn(linkButton({ variant: "ghost", size: "sm" }), pill, "px-3.5")}>
                  Log in
                </Link>
                <Link href="/signup" className={cn(linkButton({ size: "sm" }), pill, "px-4")}>
                  Sign up free
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="flex size-10 items-center justify-center rounded-full border border-border text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
          >
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => closeMenu()}
            className="fixed inset-0 top-16 -z-10 bg-background/70 backdrop-blur-sm lg:hidden"
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="mobile-nav"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease }}
            className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border bg-background lg:hidden"
          >
            <div className={cn(container, "py-4")}>
              <nav aria-label="Mobile" className="flex flex-col">
                {[...NAV_LINKS, { label: "Join a session", href: "/live" }].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => closeMenu()}
                    className="flex min-h-12 items-center rounded-lg px-3 text-lg font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>

              <div className="mt-4 grid gap-3 border-t border-border pt-4">
                {authed ? (
                  <>
                    <Link
                      href="/polls"
                      onClick={() => closeMenu()}
                      className={cn(linkButton({ size: "xl" }), pill, "w-full")}
                    >
                      Go to dashboard
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        closeMenu();
                        void logout();
                      }}
                      className={cn(linkButton({ variant: "outline", size: "xl" }), pill, "w-full")}
                    >
                      Log out
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/signup" onClick={() => closeMenu()} className={cn(linkButton({ size: "xl" }), pill, "w-full")}>
                      Sign up free
                    </Link>
                    <Link
                      href="/login"
                      onClick={() => closeMenu()}
                      className={cn(linkButton({ variant: "outline", size: "xl" }), pill, "w-full")}
                    >
                      Log in
                    </Link>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
