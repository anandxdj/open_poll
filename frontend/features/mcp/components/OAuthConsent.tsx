"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plug, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/features/auth/components/AuthShell";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { rememberInvite } from "@/features/workspaces/invites/pendingInvite";
import { ROLE_NAMES, type WorkspaceRole } from "@/features/workspaces/types";
import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api-error";
import { approveConsent, denyConsent, getConsentRequest, type ConsentRequest } from "../api/mcp.api";

const ACTION = "h-11 w-full text-sm font-medium md:h-10";

const selectClass =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-10 dark:bg-input/30";

/** The consent page's own path: where sign-in brings the user back to. */
export const consentPath = (requestId: string) => `/oauth/consent?request=${encodeURIComponent(requestId)}`;

const roleName = (role: string) => ROLE_NAMES[role as WorkspaceRole] ?? role;

/**
 * Presentation only: who is asking, where the user returns to, the workspace
 * the app will act in and the permissions it gets. The app's name comes from
 * its own registration, so it is shown as unverified next to the address the
 * browser goes back to.
 */
export function ConsentForm({
  consent,
  userEmail,
  workspaceId,
  scopes,
  busy,
  error,
  onWorkspace,
  onToggleScope,
  onApprove,
  onDeny,
}: {
  consent: ConsentRequest;
  userEmail: string | null;
  workspaceId: string;
  scopes: ReadonlySet<string>;
  busy: "approve" | "deny" | null;
  error: string | null;
  onWorkspace: (workspaceId: string) => void;
  onToggleScope: (scope: string) => void;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { client } = consent.request;
  const workspace = consent.workspaces.find((candidate) => candidate.id === workspaceId);
  return (
    <div className="space-y-5">
      <div role="note" className="flex gap-3 rounded-lg border border-border bg-secondary/50 p-3 text-sm text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden="true" />
        <p>
          Open Poll has not verified this app. Continue only if you started connecting from{" "}
          <span className="font-mono text-foreground">{client.redirectTo}</span>, where you go back after this step.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="consent-workspace" className="text-sm font-medium text-foreground">
          Workspace
        </label>
        <select
          id="consent-workspace"
          value={workspaceId}
          onChange={(event) => onWorkspace(event.target.value)}
          className={selectClass}
        >
          {consent.workspaces.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({roleName(candidate.role)})
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">
          {client.name} acts as you in this workspace only, and can only do what your role
          {workspace ? ` (${roleName(workspace.role)})` : ""} allows there.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">{client.name} will be able to</legend>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {consent.request.scopes.map(({ scope, label }) => (
            <li key={scope}>
              <label className="flex cursor-pointer items-start gap-3 px-4 py-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={scopes.has(scope)}
                  onChange={() => onToggleScope(scope)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span>{label}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          It can never delete decks, polls or sessions, and you can disconnect it any time in Settings → MCP.
        </p>
      </fieldset>

      {userEmail ? (
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{userEmail}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        <Button className={ACTION} disabled={busy !== null || scopes.size === 0 || !workspaceId} onClick={onApprove}>
          {busy === "approve" ? <Loader2 className="size-4 animate-spin" aria-label="Connecting" /> : `Allow ${client.name}`}
        </Button>
        <Button variant="outline" className={ACTION} disabled={busy !== null} onClick={onDeny}>
          {busy === "deny" ? <Loader2 className="size-4 animate-spin" aria-label="Declining" /> : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; consent: ConsentRequest }
  | { status: "expired" }
  | { status: "error" };

/**
 * /oauth/consent?request=<id>: an AI app (Claude, ChatGPT, an IDE) asks to
 * connect to Open Poll over MCP. The backend parked the request and sent the
 * browser here; approving sends it back to the app with a one-time code.
 * Signed-out visitors sign in first and come back (`pendingInvite.ts`).
 */
export function OAuthConsent({ requestId }: { requestId: string }) {
  const { user, isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [workspaceId, setWorkspaceId] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnPath = consentPath(requestId);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      rememberInvite(returnPath);
      return;
    }
    let cancelled = false;
    getConsentRequest(requestId).then(
      (consent) => {
        if (cancelled) return;
        setState({ status: "ready", consent });
        setWorkspaceId(consent.defaultWorkspaceId);
        setScopes(new Set(consent.request.scopes.map((entry) => entry.scope)));
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: getApiErrorStatus(err) === 404 ? "expired" : "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestId, returnPath, isAuthenticated, isLoading]);

  const toggleScope = (scope: string) =>
    setScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  const answer = async (choice: "approve" | "deny") => {
    setBusy(choice);
    setError(null);
    try {
      const redirectUrl =
        choice === "approve"
          ? await approveConsent(requestId, { workspaceId, scopes: [...scopes] })
          : await denyConsent(requestId);
      window.location.assign(redirectUrl);
    } catch (err) {
      if (getApiErrorStatus(err) === 404) {
        setState({ status: "expired" });
      } else {
        setError(getApiErrorMessage(err) ?? "Could not answer the request. Try again.");
      }
      setBusy(null);
    }
  };

  if (isLoading || (isAuthenticated && state.status === "loading")) {
    return (
      <AuthShell aside={false} title="Connecting an app">
        <div role="status" className="flex items-center gap-3 text-base text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-accent-ink" aria-hidden="true" />
          Loading the request…
        </div>
      </AuthShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthShell
        aside={false}
        icon={Plug}
        title="Sign in to connect an app"
        description="An AI app wants to use Open Poll for you. Sign in first; you will come back here to choose what it can do."
      >
        <div className="space-y-3">
          <Button asChild className={ACTION}>
            <Link href={`/login?next=${encodeURIComponent(returnPath)}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline" className={ACTION}>
            <Link href="/signup">Create an account</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (state.status === "expired" || state.status === "error") {
    return (
      <AuthShell
        aside={false}
        icon={TriangleAlert}
        tone="neutral"
        title={state.status === "expired" ? "This request has expired" : "Couldn't load the request"}
        description={
          state.status === "expired"
            ? "Connection requests last ten minutes and can be answered once. Start connecting again from your app."
            : "Check your connection and reload the page."
        }
      >
        <Button asChild variant="outline" className={ACTION}>
          <Link href="/settings/mcp">Go to MCP settings</Link>
        </Button>
      </AuthShell>
    );
  }

  if (state.status !== "ready") return null;
  return (
    <AuthShell
      aside={false}
      icon={Plug}
      title={`Connect ${state.consent.request.client.name} to Open Poll`}
      description="It will draft decks, run live sessions and read results for you, with the permissions you allow below."
    >
      <ConsentForm
        consent={state.consent}
        userEmail={user?.email ?? null}
        workspaceId={workspaceId}
        scopes={scopes}
        busy={busy}
        error={error}
        onWorkspace={setWorkspaceId}
        onToggleScope={toggleScope}
        onApprove={() => void answer("approve")}
        onDeny={() => void answer("deny")}
      />
    </AuthShell>
  );
}
