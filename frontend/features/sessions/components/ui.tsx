"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SessionStatus } from "../types";

/** Small building blocks shared by the sessions screens (Graph paper, `ui/design-system.md`). */

const statusTone: Record<SessionStatus, string> = {
  lobby: "border-border bg-card text-foreground",
  active: "border-success/30 bg-success/10 text-success",
  ended: "border-border bg-secondary text-muted-foreground",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const t = useTranslations("sessions.status");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusTone[status]
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "active" ? "bg-success motion-safe:animate-pulse" : status === "lobby" ? "bg-warning" : "bg-faint"
        )}
      />
      {t(status)}
    </span>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
  hint?: string;
}

/** Key numbers as one hairline strip (label above a large number), like the library's counts. */
export function StatStrip({
  stats,
  pairs = false,
  className,
}: {
  stats: Stat[];
  /** Keep two per row at every width (narrow pages such as the participant's results). */
  pairs?: boolean;
  className?: string;
}) {
  const four = !pairs && stats.length >= 4;
  const three = !pairs && stats.length === 3;
  return (
    <dl
      className={cn(
        "grid grid-cols-2 border-y border-border",
        four ? "md:grid-cols-4" : three ? "sm:grid-cols-3" : null,
        className
      )}
    >
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          title={stat.hint}
          className={cn(
            "min-w-0 py-4 sm:py-5",
            // Two per row on phones: rule between the pair, and above the second row.
            i % 2 === 1 ? "border-l border-border pl-4 sm:pl-6" : "pr-4",
            i >= 2 && "border-t border-border",
            four && i >= 2 && "md:border-t-0",
            four && i === 2 && "md:border-l md:pl-6",
            three && "sm:border-t-0",
            three && i === 2 && "col-span-2 sm:col-span-1 sm:border-l sm:pl-6"
          )}
        >
          <dt className="text-sm text-muted-foreground">{stat.label}</dt>
          <dd className="mt-1.5 truncate text-3xl font-semibold leading-none tabular-nums tracking-[-0.03em]">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Page column for the signed-in session screens, same width and rhythm as the library. */
export const page = "mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8";

/** The quiet link back to the parent screen, above the page title. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  );
}

/** A section title on the report pages: 20px, with an optional mono count beside it. */
export function SectionTitle({ id, children, count }: { id: string; children: ReactNode; count?: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 text-xl font-semibold tracking-[-0.02em]">
      {children}
      {count !== undefined ? (
        <span className="font-mono text-sm font-normal tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </h2>
  );
}

/** A running session: a neutral notice with the live dot. */
export function LiveNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-success motion-safe:animate-pulse" />
      {children}
    </p>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-muted", className)} />;
}

export function MessageCard({
  title,
  hint,
  children,
  tone = "neutral",
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-2 rounded-xl border border-border bg-card px-6 py-10 text-center"
    >
      <h2 className={cn("text-lg font-semibold tracking-[-0.02em]", tone === "error" && "text-destructive")}>{title}</h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {children ? <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
