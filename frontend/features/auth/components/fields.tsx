"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Sign-in fields are 44px on phones and 40px from `md`, with the primitive's 3:1 `input` border. */
export const fieldClass = "h-11 md:h-10";

interface FieldProps extends Omit<React.ComponentProps<"input">, "id"> {
  id: string;
  label: string;
  /** Helper line under the input, linked with aria-describedby. */
  hint?: string;
  /** Content on the label row's right edge, e.g. a "Forgot password?" link. */
  aside?: React.ReactNode;
}

function FieldFrame({
  id,
  label,
  hint,
  aside,
  children,
}: Pick<FieldProps, "id" | "label" | "hint" | "aside"> & { children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {aside}
      </div>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function AuthField({ id, label, hint, aside, className, ...props }: FieldProps) {
  return (
    <FieldFrame id={id} label={label} hint={hint} aside={aside}>
      <Input id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={cn(fieldClass, className)} {...props} />
    </FieldFrame>
  );
}

/** A password field with a show/hide toggle (44px target on phones, state exposed with aria-pressed). */
export function PasswordField({ id, label, hint, aside, className, ...props }: FieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <FieldFrame id={id} label={label} hint={hint} aside={aside}>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(fieldClass, "pr-12", className)}
          {...props}
        />
        <button
          type="button"
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring md:size-10"
        >
          {visible ? <EyeOff className="size-[18px]" aria-hidden="true" /> : <Eye className="size-[18px]" aria-hidden="true" />}
        </button>
      </div>
    </FieldFrame>
  );
}

/** The one primary action of a form: 44px on phones, spinner while busy. */
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
      className={cn("h-11 w-full text-sm font-medium md:h-10", className)}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

/** Secondary button look for the card (outline, full width). */
export const authSecondaryClass = "h-11 w-full text-sm font-medium md:h-10";

/** "or" divider between the form and the provider buttons. */
export function AuthDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
