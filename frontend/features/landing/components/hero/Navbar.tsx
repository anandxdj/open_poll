"use client";

import Link from "next/link";
import { ArrowRight, User, Settings, LogOut, LayoutDashboard } from "lucide-react";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { useState, useEffect } from "react";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import { useAuthStore } from "@/features/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { user, isAuthenticated, logout, checkAuth } = useAuthStore();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    checkAuth();
    return () => window.removeEventListener("scroll", onScroll);
  }, [checkAuth]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        scrolled
          ? "bg-background/90 backdrop-blur-xl border-b border-border"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <div className="absolute -inset-1.5 rounded-xl bg-primary/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative size-9 flex items-center justify-center">
              <ProductLogo size={44} />
            </div>
          </div>
          <span className="text-sm font-bold tracking-wide text-foreground/90">
            Open Poll
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-8">
          {["Features", "How it works", "Pricing"].map((label) => (
            <a
              key={label}
              href={`#${label.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
            >
              {label}
            </a>
          ))}
        </nav>

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <ThemeSwitch className="scale-90" />
          
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="relative group focus:outline-none">
                  <div className="absolute -inset-1 rounded-full bg-primary/20 blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative size-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 overflow-hidden shadow-sm">
                    {user?.picture && !imgError ? (
                      <img 
                        src={user.picture} 
                        alt="" 
                        className="size-full object-cover transition-transform duration-500 group-hover:scale-110" 
                        onError={() => setImgError(true)}
                      />
                    ) : (
                      getInitials(user?.name || "User")
                    )}
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={12}
                className="w-56 rounded-2xl border-border bg-background/95 backdrop-blur-xl p-1 shadow-2xl"
              >
                <div className="px-3 py-3 border-b border-border/50 mb-1">
                  <p className="text-xs font-bold text-foreground leading-none">{user?.name || "User"}</p>
                  <p className="text-[10px] text-muted-foreground leading-none mt-1.5 truncate">{user?.email || "Account"}</p>
                </div>

                <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                  Dashboard
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link
                    href="/polls"
                    className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-foreground/70 transition-colors focus:bg-primary/10 focus:text-primary"
                  >
                    <LayoutDashboard className="size-4" />
                    My Polls
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator className="my-1 bg-border/50" />
                
                <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                  Account
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link
                    href="/settings#profile"
                    className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-foreground/70 transition-colors focus:bg-primary/10 focus:text-primary"
                  >
                    <User className="size-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="/settings"
                    className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-foreground/70 transition-colors focus:bg-primary/10 focus:text-primary"
                  >
                    <Settings className="size-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator className="my-1 bg-border/50" />
                
                <DropdownMenuItem 
                  onClick={() => logout()}
                  className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-red-500 transition-colors focus:bg-red-500/10 focus:text-red-500"
                >
                  <LogOut className="size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              href="/login"
              className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] px-4 py-2 active:translate-y-px"
            >
              Sign in
            </Link>
          )}

          <Link
            href="/create"
            className="group flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] active:translate-y-px"
          >
            <span>Create poll</span>
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
