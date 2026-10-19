import { cn } from "@/lib/utils";

/**
 * Double-bezel frame for the product illustrations in the showcase. The whole
 * illustration is one image to assistive tech (`label`); what is inside is
 * sample content, never real data.
 */
export function MockFrame({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="img" aria-label={label} className={cn("relative mx-auto w-full max-w-lg", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute -inset-6 -z-10 rounded-full bg-primary/10 blur-3xl" />
      <div className="rounded-[2rem] border border-foreground/10 bg-foreground/5 p-1.5 shadow-2xl shadow-black/10 dark:shadow-black/50">
        <div className="rounded-[calc(2rem-0.375rem)] bg-card p-5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.05)] sm:p-6 dark:shadow-[inset_0_4px_20px_rgba(0,0,0,0.8)]">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Small header row used inside every illustration. */
export function MockHeader({ icon, title, badge }: { icon: React.ReactNode; title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-brand-ink">
          {icon}
        </span>
        <span className="text-base font-bold tracking-tight text-foreground">{title}</span>
      </div>
      {badge}
    </div>
  );
}

export function SampleBadge() {
  return (
    <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">Sample</span>
  );
}
