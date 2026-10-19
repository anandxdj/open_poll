"use client";

import Link from "next/link";
import { MotionConfig, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import { BrandMark } from "@/features/landing/components/shared/BrandMark";
import { cn } from "@/lib/utils";
import { AuthAside } from "./AuthAside";

const ease = [0.32, 0.72, 0, 1] as const;

const TONES = {
  info: "border-primary/30 bg-primary/10 text-accent-ink",
  success: "border-success/30 bg-success/10 text-success",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-secondary text-muted-foreground",
} as const;

export type AuthTone = keyof typeof TONES;

interface AuthShellProps {
  /** The page's h1. */
  title: string;
  description?: React.ReactNode;
  /** A status icon above the title (result states). */
  icon?: LucideIcon;
  tone?: AuthTone;
  children?: React.ReactNode;
  /** Quiet line under the content, e.g. "No account yet? Sign up". */
  footer?: React.ReactNode;
  /** Show the product panel beside the form on large screens (forms and "sent" states). */
  aside?: boolean;
}

/**
 * The frame every sign-in page shares: brand and theme switch on top, a narrow
 * column with an h1 and the form, Privacy and Terms underneath, and on large
 * screens a product panel beside it. Presentation only; the forms own their behaviour.
 */
export function AuthShell({ title, description, icon: Icon, tone = "info", children, footer, aside = true }: AuthShellProps) {
  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("mk-surface min-h-dvh bg-background text-foreground", aside && "lg:grid lg:grid-cols-2")}>
        <div className="flex min-h-dvh flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between px-4 sm:px-6 lg:px-10">
            <BrandMark />
            <ThemeSwitch className="size-10 lg:size-9" />
          </header>

          <main id="main" className="flex flex-1 items-center justify-center px-4 pb-12 pt-6 sm:px-6">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease }}
              className="w-full max-w-sm"
            >
              {Icon ? (
                <div className={cn("mb-6 flex size-12 items-center justify-center rounded-xl border", TONES[tone])}>
                  <Icon className="size-6" aria-hidden="true" />
                </div>
              ) : null}
              <h1 className="text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{title}</h1>
              {description ? (
                <p className="mt-2 text-pretty text-base leading-relaxed text-muted-foreground">{description}</p>
              ) : null}

              {children ? <div className="mt-8">{children}</div> : null}

              {footer ? <div className="mt-8 text-sm text-muted-foreground">{footer}</div> : null}
            </motion.div>
          </main>

          <footer className="flex items-center justify-center gap-6 px-4 pb-8 text-sm text-muted-foreground">
            <Link
              href="/privacy"
              className="rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Terms of use
            </Link>
          </footer>
        </div>

        {aside ? <AuthAside /> : null}
      </div>
    </MotionConfig>
  );
}

