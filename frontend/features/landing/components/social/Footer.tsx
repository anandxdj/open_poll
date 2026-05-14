"use client";

import Link from "next/link";
import { Zap } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border px-6 py-12 bg-secondary/5">
      <div className="max-w-7xl mx-auto flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center">
            <Zap className="size-4 text-primary-foreground fill-primary-foreground" />
          </div>
          <span className="text-sm font-semibold text-muted-foreground">Open Poll</span>
        </div>
        <p className="text-xs text-muted-foreground/60 order-last sm:order-none">
          © 2026 Open Poll. Real-time polling for everyone.
        </p>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <Link
            href="/polls"
            className="hover:text-foreground transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
          >
            Dashboard
          </Link>
          <Link
            href="/create"
            className="hover:text-foreground transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
          >
            Create poll
          </Link>
          <Link
            href="/privacy"
            className="hover:text-foreground transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
