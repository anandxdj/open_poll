"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MailWarning, ShieldCheck, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuthShell, type AuthTone } from "@/features/auth/components/AuthShell";
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

const ACTION = "h-11 w-full text-sm font-medium md:h-10";

/** Presentation only: the shared sign-in frame (brand, theme switch, an h1, no product panel). */
function Shell({
  title,
  description,
  icon,
  tone,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  tone?: AuthTone;
  children?: React.ReactNode;
}) {
  return (
    <AuthShell aside={false} title={title} description={description} icon={icon} tone={tone}>
      <div className="space-y-3">{children}</div>
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
        <div role="status" className="flex items-center gap-3 text-base text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-accent-ink" aria-hidden="true" />
          Loading invitation…
        </div>
      </Shell>
    );
  }

  if (preview.status === "invalid" || preview.status === "error") {
    return (
      <Shell
        icon={MailWarning}
        tone="neutral"
        title={preview.status === "invalid" ? "This invitation can't be used" : "Couldn't load the invitation"}
        description={
          preview.status === "invalid"
            ? "It may have expired, been revoked or already been accepted. Ask the person who invited you to send a new one."
            : "Check your connection and try again."
        }
      >
        <Button asChild variant="outline" className={ACTION}>
          <Link href={isAuthenticated ? "/polls" : "/login"}>{isAuthenticated ? "Go to your polls" : "Sign in"}</Link>
        </Button>
      </Shell>
    );
  }

  const { invite } = preview;
  return (
    <Shell
      icon={ShieldCheck}
      title={`Join ${invite.workspaceName} on Open Poll`}
      description={
        <>
          {invite.inviterName ? `${invite.inviterName} invited you` : "You're invited"} as{" "}
          <strong className="text-foreground">{ROLE_NAMES[invite.role]}</strong>. {ROLE_DESCRIPTIONS[invite.role]}
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Invitation for <span className="font-mono text-foreground">{invite.email}</span>
      </p>

      {isAuthenticated && user ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
          {error ? (
            <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <p>{error.message}</p>
              {error.code === "INVITE_EMAIL_MISMATCH" || error.code === "EMAIL_NOT_VERIFIED" ? (
                <Button type="button" variant="outline" className="min-h-10" onClick={() => void signOutAndReturn()}>
                  Sign in with a different account
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button className={ACTION} disabled={accepting} onClick={() => void accept()}>
            {accepting ? <Loader2 className="size-4 animate-spin" aria-label="Joining" /> : `Join ${invite.workspaceName}`}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sign in with the invited email address to accept. New here? Create an account with that address first.
          </p>
          <Button asChild className={ACTION}>
            <Link href={`/login?next=${encodeURIComponent(invitePath(token))}`}>Sign in to accept</Link>
          </Button>
          <Button asChild variant="outline" className={ACTION}>
            <Link href="/signup">Create an account</Link>
          </Button>
        </div>
      )}
    </Shell>
  );
}
