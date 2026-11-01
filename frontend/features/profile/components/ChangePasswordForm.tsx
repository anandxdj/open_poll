"use client";

import { useState } from "react";
import Link from "next/link";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { AuthSubmit, PasswordField } from "@/features/auth/components/fields";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { textLink } from "@/features/landing/components/shared/styles";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { ACCOUNT_ERROR_CODES, PASSWORD_RULE, newPasswordProblem } from "../account";
import { changePassword } from "../api/profile.api";

const errorCode = (err: unknown) => (isAxiosError<{ code?: string }>(err) ? err.response?.data?.code : undefined);

interface FieldErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

/**
 * Current, new and confirm, each with show/hide. On success every other
 * device is signed out and this one keeps going with the new tokens.
 */
export function ChangePasswordForm() {
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: FieldErrors = {
      current: current ? undefined : "Enter your current password.",
      next: newPasswordProblem(next) ?? undefined,
      confirm: confirm === next ? undefined : "The passwords don't match.",
    };
    setDone(false);
    setErrors(found);
    if (found.current || found.next || found.confirm) return;

    setBusy(true);
    try {
      const { user, accessToken } = await changePassword({ currentPassword: current, newPassword: next });
      setToken(accessToken);
      setUser(user);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
      toast.success("Password changed. Other devices were signed out.");
    } catch (err) {
      if (errorCode(err) === ACCOUNT_ERROR_CODES.wrongPassword) {
        setErrors({ current: "That isn't your current password." });
      } else {
        toast.error(getApiErrorMessage(err) ?? "Your password could not be changed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="space-y-5">
      <PasswordField
        id="current-password"
        name="currentPassword"
        label="Current password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        disabled={busy}
        error={errors.current}
        aside={
          <Link href="/forgot-password" className={cn(textLink, "inline-flex min-h-10 items-center text-sm")}>
            Forgot it?
          </Link>
        }
      />
      <PasswordField
        id="new-password"
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        hint={PASSWORD_RULE}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        disabled={busy}
        error={errors.next}
      />
      <PasswordField
        id="confirm-password"
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={busy}
        error={errors.confirm}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <AuthSubmit variant="ink" loading={busy} disabled={busy} className="sm:w-auto sm:px-5">
          Change password
        </AuthSubmit>
        {done ? (
          <p role="status" className="text-sm text-muted-foreground">
            Changed. You&apos;re still signed in here; other devices were signed out.
          </p>
        ) : null}
      </div>
    </form>
  );
}
