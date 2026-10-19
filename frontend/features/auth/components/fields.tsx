"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Field styling for the sign-in pages: 44px tall, a 3:1 boundary
 * (`field-border`) and a brand-coloured focus state that reads on both themes.
 */
export const fieldClass =
  "h-11 rounded-xl border-field-border bg-background/60 px-4 text-base md:text-base dark:bg-background/60 focus-visible:border-brand-ink focus-visible:ring-brand-ink/25";

interface FieldProps extends Omit<React.ComponentProps<"input">, "id"> {
  id: string;
  label: string;
  /** Helper line under the input, linked with aria-describedby. */
  hint?: string;
  /** Content on the label row's right edge, e.g. a "Forgot?" link. */
  aside?: React.ReactNode;
}

export function AuthField({ id, label, hint, aside, className, ...props }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
        </Label>
        {aside}
      </div>
      <Input id={id} aria-describedby={hintId} className={cn(fieldClass, className)} {...props} />
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A password field with a show/hide toggle (44px target, state exposed with aria-pressed). */
export function PasswordField({ id, label, hint, aside, className, ...props }: FieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
        </Label>
        {aside}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          aria-describedby={hintId}
          className={cn(fieldClass, "pr-12", className)}
          {...props}
        />
        <button
          type="button"
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
          className="mk-focus absolute right-0.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff className="size-[18px]" aria-hidden="true" /> : <Eye className="size-[18px]" aria-hidden="true" />}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Primary submit/action button: 44px, rounded like the marketing buttons, spinner while busy. */
export function AuthSubmit({
  loading,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button
      type="submit"
      aria-busy={loading || undefined}
      className={cn(
        "h-11 w-full rounded-2xl text-base font-semibold shadow-lg shadow-primary/20 focus-visible:border-brand-ink focus-visible:ring-brand-ink/40",
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

/** Secondary button/link look for the card (outline). */
export const authSecondaryClass =
  "h-11 w-full rounded-2xl border-foreground/20 text-base font-medium focus-visible:border-brand-ink focus-visible:ring-brand-ink/40";

/** "or continue with" divider. */
export function AuthDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
