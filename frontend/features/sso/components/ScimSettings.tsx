"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SettingsFailed,
  SettingsHeading,
  SettingsLoading,
  settingsCard,
  settingsList,
} from "@/features/workspaces/settings/blocks";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { createScimToken, listScimTokens, revokeScimToken } from "../api/sso.api";
import type { ScimToken } from "../types";
import { CopyValue } from "@/features/workspaces/settings/CopyValue";
import { useSsoGate } from "./SsoSettings";
import { SectionUnavailable } from "@/features/workspaces/settings/SectionUnavailable";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

/** /settings/scim: the SCIM base URL and the tokens identity providers provision with (W3-D). */
export function ScimSettings() {
  const { detail, failed: workspaceFailed, retry: retryWorkspace, ready, reason } = useSsoGate("scim");
  const workspaceId = detail && !reason ? detail.workspace._id : null;
  const [data, setData] = useState<{ id: string; baseUrl: string; tokens: ScimToken[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [label, setLabel] = useState("Okta");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    listScimTokens(workspaceId).then(
      (result) => {
        if (cancelled) return;
        setFailed(false);
        setData({ id: workspaceId, ...result });
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attempt]);

  const header = (
    <SettingsHeading
      title="SCIM provisioning"
      description="Your identity provider adds, updates and removes members and groups here, so access follows your directory."
    />
  );

  if (workspaceFailed) return <SettingsFailed message="This workspace could not be loaded." onRetry={retryWorkspace} />;
  if (!ready) return <SettingsLoading>Loading SCIM provisioning…</SettingsLoading>;
  if (reason) return <SectionUnavailable id="scim" title="SCIM provisioning" description="Your identity provider adds, updates and removes members and groups here." />;
  if (failed) return <SettingsFailed message="SCIM tokens could not be loaded." onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data || data.id !== workspaceId) return <SettingsLoading>Loading SCIM tokens…</SettingsLoading>;

  return (
    <div className="space-y-10">
      {header}

      <section aria-labelledby="scim-connect-title" className="space-y-4">
        <SettingsHeading id="scim-connect-title" title="Connect your identity provider" />
        <div className={cn(settingsCard, "space-y-4")}>
          <CopyValue label="SCIM base URL (tenant URL)" value={data.baseUrl} />
          <p className="text-sm text-muted-foreground">
            Use a token below as the bearer token (secret token). Deactivated people are signed out and lose access; people
            added here sign in with single sign-on.
          </p>
        </div>
      </section>

      <section aria-labelledby="scim-tokens-title" className="space-y-4">
        <SettingsHeading id="scim-tokens-title" title="Tokens" />
        {issued ? (
          <div role="status" className={cn(settingsCard, "space-y-3 border-success/40")}>
            <p className="text-sm font-medium">Copy the token now. It is not shown again.</p>
            <CopyValue label="SCIM token" value={issued} />
            <Button variant="outline" size="sm" className="bg-card" onClick={() => setIssued(null)}>
              Done
            </Button>
          </div>
        ) : null}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!label.trim()) return;
            setBusy(true);
            try {
              const created = await createScimToken(workspaceId!, label.trim());
              setIssued(created.token);
              setData({ ...data, tokens: [created, ...data.tokens] });
            } catch (err) {
              toast.error(getApiErrorMessage(err) ?? "The token could not be created.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="scim-token-label">Name</Label>
            <Input id="scim-token-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} className="h-9 w-56 bg-card" />
          </div>
          <Button type="submit" disabled={busy || !label.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Create token
          </Button>
        </form>
        {data.tokens.length ? (
          <ul className={settingsList}>
            {data.tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{token.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {token.prefix}…{token.last4} · created {formatDate(token.createdAt)}
                    {token.lastUsedAt ? ` · last used ${formatDate(token.lastUsedAt)}` : " · never used"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`Revoke ${token.label}? Provisioning with it stops at once.`)) return;
                    try {
                      await revokeScimToken(workspaceId!, token.id);
                      setData({ ...data, tokens: data.tokens.filter((t) => t.id !== token.id) });
                      toast.success("Token revoked");
                    } catch (err) {
                      toast.error(getApiErrorMessage(err) ?? "The token could not be revoked.");
                    }
                  }}
                >
                  <Trash2 className="size-4" /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        )}
      </section>
    </div>
  );
}
