import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Building blocks every /settings page uses, so sections look the same across
 * features (workspaces, members, billing, MCP, audit): a white sheet on the
 * paper, a heading with one sentence, and the loading and failure states.
 */

/** The white sheet a section's content sits on. */
export const settingsCard = "rounded-xl border border-border bg-card p-5 sm:p-6";

/** A sheet of rows split by hairlines (each row brings its own padding). */
export const settingsList = "divide-y divide-border rounded-xl border border-border bg-card";

export function SettingsHeading({
  id,
  title,
  description,
  className,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <h2 id={id} className="text-xl font-semibold tracking-[-0.02em] text-foreground">
        {title}
      </h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** One setting: label and help on the left, its control on the right (stacked on phones). */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium text-foreground">{label}</p>
        )}
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsLoading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {children}
    </div>
  );
}

export function SettingsFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cn(settingsCard, "space-y-3")}>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
