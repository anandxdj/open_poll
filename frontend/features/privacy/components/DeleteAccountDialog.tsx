"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { rememberInvite } from "@/features/workspaces/invites/pendingInvite";
import { getApiErrorMessage } from "@/lib/api-error";
import { confirmPassword, deleteAccount } from "../api/privacy.api";
import { deletionConsequences, purgeDateFrom, reauthValid } from "../format";
import { PRIVACY_ERROR_CODES, type PrivacyStatus } from "../types";

const PRIVACY_PATH = "/settings/privacy";

const errorCode = (err: unknown) => (isAxiosError<{ code?: string }>(err) ? err.response?.data?.code : undefined);

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: PrivacyStatus;
  /** Called when the server refused (blockers changed, the 5 minutes ran out): the page re-reads its status. */
  onRefused: () => void;
}

/**
 * Says what deleting the account does, asks for proof of identity when the
 * last sign-in is older than 5 minutes (the password, or a new sign-in for
 * accounts without one), then deletes and signs out.
 */
export function DeleteAccountDialog({ open, onOpenChange, status, onRefused }: DeleteAccountDialogProps) {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read once per opening (the page remounts the dialog each time) so nothing shifts while it is open.
  const [openedAt] = useState(() => Date.now());

  const needsProof = !reauthValid(status, openedAt);
  const consequences = deletionConsequences(status, purgeDateFrom(openedAt, status.deletionGraceDays));

  async function signInAgain() {
    rememberInvite(PRIVACY_PATH);
    await logout();
    router.push(`/login?next=${encodeURIComponent(PRIVACY_PATH)}`);
  }

  async function confirm() {
    setBusy(true);
    setPasswordError(null);
    try {
      if (needsProof && status.hasPassword) {
        try {
          await confirmPassword(password);
        } catch (err) {
          if (errorCode(err) === PRIVACY_ERROR_CODES.wrongPassword) {
            setPasswordError("That password is not right.");
            setBusy(false);
            return;
          }
          throw err;
        }
      }
      const { purgeAt } = await deleteAccount();
      await logout();
      router.replace(`/login?deleted=${encodeURIComponent(purgeAt)}`);
    } catch (err) {
      setBusy(false);
      toast.error(getApiErrorMessage(err) ?? "Your account could not be deleted. Try again.");
      onOpenChange(false);
      onRefused();
    }
  }

  const canSubmit = !busy && (!needsProof || !status.hasPassword || password.length > 0);

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-semibold">Delete your account?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <ul className="list-disc space-y-1.5 pl-5 text-left text-sm text-muted-foreground">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsProof && status.hasPassword ? (
          <form
            id="delete-account-form"
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void confirm();
            }}
          >
            <Label htmlFor="delete-account-password">Enter your password to confirm</Label>
            <Input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "delete-account-password-error" : undefined}
              disabled={busy}
            />
            {passwordError ? (
              <p id="delete-account-password-error" className="text-sm text-destructive">
                {passwordError}
              </p>
            ) : null}
          </form>
        ) : null}

        {needsProof && !status.hasPassword ? (
          <p className="text-sm text-muted-foreground">
            For your safety, log in again first. You come back here and have 5 minutes to finish.
          </p>
        ) : null}

        <AlertDialogFooter className="mt-2 gap-3">
          <AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel>
          {needsProof && !status.hasPassword ? (
            <Button variant="outline" onClick={() => void signInAgain()}>
              Log in again
            </Button>
          ) : (
            <Button
              type={needsProof ? "submit" : "button"}
              form={needsProof ? "delete-account-form" : undefined}
              onClick={needsProof ? undefined : () => void confirm()}
              disabled={!canSubmit}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Delete account
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
