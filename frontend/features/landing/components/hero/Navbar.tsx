"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, LayoutDashboard, LogOut, Menu, Settings, User, X } from "lucide-react";
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
import { button, container } from "../shared/styles";

const ease = [0.32, 0.72, 0, 1] as const;

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const menuItem =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground/80 focus:bg-primary/10 focus:text-foreground";

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
    const onScroll = () => setScrolled(window.scrollY > 12);
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
        "fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
        solid ? "border-border bg-background/90 backdrop-blur-xl" : "border-transparent bg-transparent",
      )}
    >
      <div className={cn(container, "flex h-16 items-center justify-between gap-4")}>
        <BrandMark />

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="mk-focus inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeSwitch className="size-11 lg:size-10" />

          {/* Desktop actions */}
          <div className="hidden items-center gap-2 lg:flex">
            <Link href="/live" className={button.ghost}>
              Join a session
            </Link>
            {authed ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Account menu"
                      className="mk-focus flex size-10 items-center justify-center overflow-hidden rounded-full border border-primary/30 bg-primary/10 text-xs font-bold text-brand-ink"
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
                  <DropdownMenuContent
                    align="end"
                    sideOffset={12}
                    className="w-60 rounded-2xl border-border bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl"
                  >
                    <div className="mb-1 border-b border-border px-3 pb-3 pt-2">
                      <p className="truncate text-sm font-bold text-foreground">{user?.name || "Your account"}</p>
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
                    <DropdownMenuSeparator className="my-1 bg-border" />
                    <DropdownMenuItem
                      onClick={() => void logout()}
                      className={cn(menuItem, "text-destructive focus:bg-destructive/10 focus:text-destructive")}
                    >
                      <LogOut className="size-4" aria-hidden="true" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Link href="/polls" className={button.primary}>
                  Dashboard
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className={button.ghost}>
                  Log in
                </Link>
                <Link href="/signup" className={button.primary}>
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
            className="mk-focus flex size-11 items-center justify-center rounded-xl border border-foreground/15 bg-foreground/[0.03] text-foreground transition-colors duration-300 hover:bg-foreground/[0.07] lg:hidden"
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
            transition={{ duration: 0.3 }}
            onClick={() => closeMenu()}
            className="fixed inset-0 top-16 -z-10 bg-background/60 backdrop-blur-sm lg:hidden"
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="mobile-nav"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease }}
            className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border bg-background shadow-2xl lg:hidden"
          >
            <div className={cn(container, "py-4")}>
              <nav aria-label="Mobile" className="flex flex-col">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => closeMenu()}
                    className="mk-focus flex min-h-12 items-center rounded-xl px-3 text-lg font-medium text-foreground transition-colors hover:bg-foreground/[0.05]"
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/live"
                  onClick={() => closeMenu()}
                  className="mk-focus flex min-h-12 items-center rounded-xl px-3 text-lg font-medium text-foreground transition-colors hover:bg-foreground/[0.05]"
                >
                  Join a session
                </Link>
              </nav>

              <div className="mt-4 grid gap-3 border-t border-border pt-4">
                {authed ? (
                  <>
                    <Link href="/polls" onClick={() => closeMenu()} className={cn(button.primaryLg, "w-full")}>
                      Go to dashboard
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        closeMenu();
                        void logout();
                      }}
                      className={cn(button.secondaryLg, "w-full")}
                    >
                      Log out
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/signup" onClick={() => closeMenu()} className={cn(button.primaryLg, "w-full")}>
                      Sign up free
                    </Link>
                    <Link href="/login" onClick={() => closeMenu()} className={cn(button.secondaryLg, "w-full")}>
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
