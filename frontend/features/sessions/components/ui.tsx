"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SessionStatus } from "../types";

/** Small building blocks shared by the sessions screens. */

const statusTone: Record<SessionStatus, string> = {
  lobby: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  ended: "border-border bg-secondary/40 text-muted-foreground",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const t = useTranslations("sessions.status");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
        statusTone[status]
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "active" ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-current opacity-60"
        )}
      />
      {t(status)}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card px-4 py-3", className)} title={hint}>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{label}</dt>
      <dd className="mt-1 truncate text-xl font-bold tabular-nums tracking-tight text-foreground/90">{value}</dd>
    </div>
  );
}

/** Sticky page header used by the dashboard screens, matching the library's. */
export function PageHeader({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur-xl md:px-6">
      {children}
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-2xl border border-border bg-secondary/30", className)} />;
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
      className="mx-auto flex w-full max-w-md flex-col items-center gap-2 rounded-[2rem] border border-border bg-card px-6 py-10 text-center"
    >
      <h2 className={cn("text-lg font-bold tracking-tight", tone === "error" && "text-red-500")}>{title}</h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {children ? <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
