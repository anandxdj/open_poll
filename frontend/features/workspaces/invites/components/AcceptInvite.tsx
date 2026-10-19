"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MailWarning, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/features/auth/components/AuthShell";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import { switchWorkspace } from "../../api/workspaces.api";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { ROLE_NAMES } from "../../types";
import { ROLE_DESCRIPTIONS } from "../../members/roles";
import type { InvitePreview } from "../../members/types";
import { acceptInvite, previewInvite } from "../api/invites.api";
import { getApiErrorCode } from "../errors";
import { forgetInvite, invitePath, rememberInvite } from "../pendingInvite";

type PreviewState = { status: "loading" } | { status: "ready"; invite: InvitePreview } | { status: "invalid" } | { status: "error" };

const ACTION_PRIMARY =
  "h-11 w-full rounded-2xl text-base font-semibold shadow-lg shadow-primary/20 focus-visible:border-brand-ink focus-visible:ring-brand-ink/40";
const ACTION_OUTLINE =
  "h-11 w-full rounded-2xl border-foreground/20 text-base font-medium focus-visible:border-brand-ink focus-visible:ring-brand-ink/40";

/** Presentation only: the shared auth frame (brand, theme switch, one bezel card, an h1). */
function Shell({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <AuthShell title={title} description={description}>
      <div className="space-y-5">{children}</div>
    </AuthShell>
  );
}

/**
 * /invites/<token>: shows what the invitation is for, then joins the signed-in
 * user. Signed-out visitors are sent to sign in (or sign up) and come back
 * here afterwards (`pendingInvite.ts`).
 */
export function AcceptInvite({ token }: { token: string }) {
  const { user, isAuthenticated, isLoading, checkAuth, logout } = useAuthStore();
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => {
    void checkAuth();
    rememberInvite(invitePath(token));
    let cancelled = false;
    previewInvite(token).then(
      (invite) => {
        if (!cancelled) setPreview({ status: "ready", invite });
      },
      (err: unknown) => {
        if (cancelled) return;
        // 404 = unknown, expired, used or revoked (deliberately indistinguishable); 429/5xx = try again.
        setPreview({ status: getApiErrorStatus(err) === 404 ? "invalid" : "error" });
        if (getApiErrorStatus(err) === 404) forgetInvite();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, checkAuth]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const joined = await acceptInvite(token);
      forgetInvite();
      toast.success(joined.alreadyMember ? "You're already a member" : `Welcome to ${joined.workspace.name}`);
      // Make it the default and the selected workspace, then start fresh in it.
      await switchWorkspace(joined.workspace._id).catch(() => undefined);
      useWorkspaceStore.getState().select(joined.workspace._id);
      window.location.assign("/polls");
    } catch (err) {
      setError({ message: getApiErrorMessage(err) ?? "Could not accept the invitation", code: getApiErrorCode(err) });
      setAccepting(false);
    }
  };

  const signOutAndReturn = async () => {
    await logout();
    window.location.assign(`/login?next=${encodeURIComponent(invitePath(token))}`);
  };

  if (preview.status === "loading" || isLoading) {
    return (
      <Shell title="Loading your invitation">
        <div role="status" className="flex items-center justify-center gap-2 py-4 text-base text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading invitation…
        </div>
      </Shell>
    );
  }

  if (preview.status === "invalid" || preview.status === "error") {
    return (
      <Shell
        title={preview.status === "invalid" ? "This invitation can't be used" : "Couldn't load the invitation"}
        description={
          preview.status === "invalid"
            ? "It may have expired, been revoked or already been accepted. Ask the person who invited you to send a new one."
            : "Check your connection and try again."
        }
      >
        <div className="flex justify-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MailWarning className="size-8" aria-hidden="true" />
          </span>
        </div>
        <Button asChild variant="outline" className={ACTION_OUTLINE}>
          <Link href={isAuthenticated ? "/polls" : "/login"}>{isAuthenticated ? "Go to your polls" : "Sign in"}</Link>
        </Button>
      </Shell>
    );
  }

  const { invite } = preview;
  return (
    <Shell
      title={`Join ${invite.workspaceName} on Open Poll`}
      description={
        <>
          {invite.inviterName ? `${invite.inviterName} invited you` : "You're invited"} as{" "}
          <strong className="text-foreground">{ROLE_NAMES[invite.role]}</strong>. {ROLE_DESCRIPTIONS[invite.role]}
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-brand-ink">
          <ShieldCheck className="size-8" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground">
          Invitation for <span className="font-mono text-foreground">{invite.email}</span>
        </p>
      </div>

      {isAuthenticated && user ? (
        <div className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
          {error ? (
            <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive dark:text-red-400">
              <p>{error.message}</p>
              {error.code === "INVITE_EMAIL_MISMATCH" || error.code === "EMAIL_NOT_VERIFIED" ? (
                <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => void signOutAndReturn()}>
                  Sign in with a different account
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button className={ACTION_PRIMARY} disabled={accepting} onClick={() => void accept()}>
            {accepting ? <Loader2 className="size-4 animate-spin" aria-label="Joining" /> : `Join ${invite.workspaceName}`}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            Sign in with the invited email address to accept. New here? Create an account with that address first.
          </p>
          <Button asChild className={ACTION_PRIMARY}>
            <Link href={`/login?next=${encodeURIComponent(invitePath(token))}`}>Sign in to accept</Link>
          </Button>
          <Button asChild variant="outline" className={ACTION_OUTLINE}>
            <Link href="/signup">Create an account</Link>
          </Button>
        </div>
      )}
    </Shell>
  );
}
