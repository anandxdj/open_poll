import { cn } from "@/lib/utils";

/**
 * Frame for the product illustrations in "How it works": one bordered panel with
 * a title bar. The whole illustration is one image to assistive tech (`label`);
 * what is inside is sample content, never real data.
 */
export function MockFrame({
  label,
  icon,
  title,
  children,
  className,
}: {
  label: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_48px_-24px_rgb(23_23_23/0.25)] dark:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.7)]",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 text-sm font-semibold tracking-tight text-foreground">
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        {title}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
