"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateWorkspace } from "@/features/workspaces/api/workspaces.api";
import { useCapabilities, useCurrentWorkspace } from "@/features/workspaces/hooks/useWorkspaces";
import {
  SettingsFailed,
  SettingsHeading,
  SettingsLoading,
  SettingsRow,
  settingsCard,
  settingsList,
} from "@/features/workspaces/settings/blocks";
import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { createConnection, getSso } from "../api/sso.api";
import type { SsoConnection, SsoOverview } from "../types";
import { ConnectionCard } from "./ConnectionCard";
import { SectionUnavailable } from "@/features/workspaces/settings/SectionUnavailable";

/** Why the page can't be used here, or null when it can (the nav says the same in one line). */
export function useSsoGate(feature: "sso" | "scim") {
  const { detail, failed, retry } = useCurrentWorkspace();
  const capabilities = useCapabilities();
  let reason: string | null = null;
  if (capabilities && !capabilities[feature === "sso" ? "samlSso" : "scim"]) {
    reason = feature === "sso" ? "Single sign-on isn't enabled on this server." : "SCIM provisioning isn't enabled on this server.";
  } else if (detail && detail.workspace.type !== "team") {
    reason = "Only team workspaces have this. Create one from the workspace menu.";
  } else if (detail && !detail.entitlements.features[feature]) {
    reason = "Your plan doesn't include this. It comes with Enterprise.";
  } else if (detail && !detail.permissions.includes("workspace:sso")) {
    reason = "Only owners and admins manage this.";
  }
  return { detail, failed, retry, ready: Boolean(detail && capabilities), reason };
}

function useSsoOverview(workspaceId: string | null) {
  const [loaded, setLoaded] = useState<{ id: string; data: SsoOverview | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    getSso(workspaceId).then(
      (data) => !cancelled && setLoaded({ id: workspaceId, data }),
      () => !cancelled && setLoaded({ id: workspaceId, data: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attempt]);
  const current = loaded?.id === workspaceId ? loaded : null;
  const set = useCallback((data: SsoOverview) => workspaceId && setLoaded({ id: workspaceId, data }), [workspaceId]);
  return { overview: current?.data ?? null, loading: current === null, failed: current !== null && current.data === null, retry: () => setAttempt((n) => n + 1), set };
}

function NewConnection({ workspaceId, onCreated }: { workspaceId: string; onCreated: (c: SsoConnection) => void }) {
  const [type, setType] = useState<"saml" | "oidc" | null>(null);
  const [name, setName] = useState("");
  const [oidc, setOidc] = useState({ issuer: "", clientId: "", clientSecret: "" });
  const [busy, setBusy] = useState(false);

  if (!type) {
    return (
      <div className={cn(settingsCard, "flex flex-wrap items-center justify-between gap-4")}>
        <p className="text-sm text-muted-foreground">Connect Okta, Microsoft Entra ID, Google Workspace or any SAML 2.0 or OpenID Connect provider.</p>
        <div className="flex gap-2">
          <Button onClick={() => setType("saml")}>
            <Plus className="size-4" /> SAML connection
          </Button>
          <Button variant="outline" className="bg-card" onClick={() => setType("oidc")}>
            <Plus className="size-4" /> OIDC connection
          </Button>
        </div>
      </div>
    );
  }

  const valid = name.trim() && (type === "saml" || (oidc.issuer && oidc.clientId && oidc.clientSecret));
  return (
    <form
      aria-label={`New ${type === "saml" ? "SAML" : "OIDC"} connection`}
      className={cn(settingsCard, "space-y-4")}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        try {
          onCreated(await createConnection(workspaceId, { name: name.trim(), type, ...(type === "oidc" ? { oidc } : {}) }));
          toast.success("Connection created");
          setType(null);
          setName("");
        } catch (err) {
          toast.error(getApiErrorMessage(err) ?? "The connection could not be created.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="text-base font-semibold">New {type === "saml" ? "SAML" : "OIDC"} connection</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sso-new-name">Name</Label>
          <Input id="sso-new-name" placeholder={type === "saml" ? "Okta" : "Microsoft Entra ID"} value={name} onChange={(e) => setName(e.target.value)} className="bg-card" />
        </div>
        {type === "oidc" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="sso-new-issuer">Issuer URL</Label>
              <Input id="sso-new-issuer" type="url" value={oidc.issuer} onChange={(e) => setOidc({ ...oidc, issuer: e.target.value })} className="bg-card" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-new-client">Client ID</Label>
              <Input id="sso-new-client" value={oidc.clientId} onChange={(e) => setOidc({ ...oidc, clientId: e.target.value })} className="bg-card" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-new-secret">Client secret</Label>
              <Input id="sso-new-secret" type="password" autoComplete="off" value={oidc.clientSecret} onChange={(e) => setOidc({ ...oidc, clientSecret: e.target.value })} className="bg-card" />
            </div>
          </>
        ) : null}
      </div>
      {type === "saml" ? <p className="text-sm text-muted-foreground">Next you get the values for your IdP and paste its metadata.</p> : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !valid}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Create connection
        </Button>
        <Button type="button" variant="outline" className="bg-card" onClick={() => setType(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** /settings/sso: the workspace's SAML and OIDC connections and "require single sign-on" (W3-D). */
export function SsoSettings() {
  const router = useRouter();
  const { detail, failed: workspaceFailed, retry: retryWorkspace, ready, reason } = useSsoGate("sso");
  const workspaceId = detail && !reason ? detail.workspace._id : null;
  const { overview, loading, failed, retry, set } = useSsoOverview(workspaceId);
  const [saving, setSaving] = useState(false);

  // Back from a test sign-in (`?test=success|domain`).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const test = params.get("test");
    if (!test) return;
    if (test === "success") toast.success("Test sign-in worked. Single sign-on can now be required.");
    else toast.error("The test sign-in came back with an email outside the verified domains.");
    router.replace("/settings/sso");
  }, [router]);

  const header = (
    <SettingsHeading
      title="Single sign-on"
      description="People in your company sign in with your identity provider instead of a password."
    />
  );

  if (workspaceFailed) return <SettingsFailed message="This workspace could not be loaded." onRetry={retryWorkspace} />;
  if (!ready) return <SettingsLoading>Loading single sign-on…</SettingsLoading>;
  if (reason) return <SectionUnavailable id="sso" title="Single sign-on" description="People in your company sign in with your identity provider instead of a password." />;
  if (failed) return <SettingsFailed message="Single sign-on settings could not be loaded." onRetry={retry} />;
  if (loading || !overview) return <SettingsLoading>Loading connections…</SettingsLoading>;

  const replace = (next: SsoConnection) => set({ ...overview, connections: overview.connections.map((c) => (c.id === next.id ? next : c)) });
  const canRequire = overview.connections.some((c) => c.enabled && c.domains.some((d) => d.verified) && c.lastTest);

  return (
    <div className="space-y-10">
      {header}

      <div className={settingsList}>
        <SettingsRow
          label="Require single sign-on"
          htmlFor="require-sso"
          description={
            canRequire || overview.requireSso
              ? "Members with a verified-domain email can't sign in with a password or Google. The workspace owner always can."
              : "Turn on a connection with a verified domain and run a test sign-in first."
          }
        >
          <Switch
            id="require-sso"
            checked={overview.requireSso}
            disabled={saving || (!canRequire && !overview.requireSso)}
            onCheckedChange={async (requireSso) => {
              setSaving(true);
              try {
                const updated = await updateWorkspace(detail!.workspace._id, { settings: { requireSso } });
                useWorkspaceStore.getState().setCurrent(updated);
                set({ ...overview, requireSso });
                toast.success(requireSso ? "Single sign-on is now required" : "Single sign-on is no longer required");
              } catch (err) {
                toast.error(getApiErrorMessage(err) ?? "The setting could not be saved.");
              } finally {
                setSaving(false);
              }
            }}
          />
        </SettingsRow>
      </div>

      {overview.connections.map((connection) => (
        <ConnectionCard
          key={connection.id}
          workspaceId={detail!.workspace._id}
          connection={connection}
          onChange={(next) => {
            replace(next);
            if (!next.enabled) retry();
          }}
          onRemoved={() => retry()}
        />
      ))}

      {overview.connections.length < 5 ? (
        <NewConnection workspaceId={detail!.workspace._id} onCreated={(c) => set({ ...overview, connections: [...overview.connections, c] })} />
      ) : null}
    </div>
  );
}
