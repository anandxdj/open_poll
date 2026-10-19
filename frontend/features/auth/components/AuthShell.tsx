"use client";

import { MotionConfig, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, type LucideIcon } from "lucide-react";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import { BrandMark } from "@/features/landing/components/shared/BrandMark";
import { container } from "@/features/landing/components/shared/styles";
import { cn } from "@/lib/utils";

const ease = [0.32, 0.72, 0, 1] as const;

interface AuthShellProps {
  /** The page's h1. */
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Quiet line under the card, e.g. "No account yet? Sign up". */
  footer?: React.ReactNode;
  /** Wider card for pages with more content. */
  width?: "sm" | "md";
}

/**
 * The frame every sign-in page shares: brand and theme switch on top, one
 * double-bezel card with an h1 above it. Presentation only; the forms inside
 * own their behaviour.
 */
export function AuthShell({ title, description, children, footer, width = "md" }: AuthShellProps) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="mk-surface relative flex min-h-dvh flex-col overflow-x-clip bg-radial-glow text-foreground">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 size-[32rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-[120px]"
        />

        <header className={cn(container, "relative z-10 flex h-16 shrink-0 items-center justify-between")}>
          <BrandMark />
          <ThemeSwitch className="size-11" />
        </header>

        <main id="main" className="relative z-10 flex flex-1 items-center justify-center px-5 pb-16 pt-6 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
            className={cn("w-full", width === "sm" ? "max-w-sm" : "max-w-md")}
          >
            <div className="mb-8 text-center">
              <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
              {description ? (
                <p className="mt-3 text-pretty text-base leading-relaxed text-muted-foreground">{description}</p>
              ) : null}
            </div>

            {/* Double bezel */}
            <div className="rounded-[2rem] border border-foreground/10 bg-foreground/5 p-1.5 shadow-2xl shadow-black/10 dark:shadow-black/50">
              <div className="rounded-[calc(2rem-0.375rem)] bg-card p-6 shadow-[inset_0_2px_10px_rgba(0,0,0,0.05)] sm:p-8 dark:shadow-[inset_0_4px_20px_rgba(0,0,0,0.8)]">
                {children}
              </div>
            </div>

            {footer ? <div className="mt-6 text-center text-base text-muted-foreground">{footer}</div> : null}
          </motion.div>
        </main>
      </div>
    </MotionConfig>
  );
}

const TONES = {
  info: { ring: "bg-primary/10 text-brand-ink", icon: CheckCircle2 },
  success: { ring: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  error: { ring: "bg-destructive/10 text-destructive dark:text-red-400", icon: AlertCircle },
} as const;

interface AuthStatusProps {
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  /** h2 inside the card. */
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Icon, headline, message and actions for the result states (sent, verified, expired, invalid). */
export function AuthStatus({ tone = "info", icon, title, children, actions, className }: AuthStatusProps) {
  const t = TONES[tone];
  const Icon = icon ?? t.icon;
  return (
    <div className={cn("space-y-6 text-center", className)}>
      <div className={cn("mx-auto flex size-16 items-center justify-center rounded-full", t.ring)}>
        <Icon className="size-8" aria-hidden="true" />
      </div>
      {title || children ? (
        <div className="space-y-2">
          {title ? <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2> : null}
          {children ? <div className="text-base leading-relaxed text-muted-foreground">{children}</div> : null}
        </div>
      ) : null}
      {actions ? <div className="grid gap-3">{actions}</div> : null}
    </div>
  );
}
