"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCapabilities, useCurrentWorkspace } from "@/features/workspaces/hooks/useWorkspaces";
import { CopyValue } from "@/features/workspaces/settings/CopyValue";
import { SettingsFailed, SettingsHeading, SettingsLoading, settingsCard } from "@/features/workspaces/settings/blocks";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { addDomain, listDomains, removeDomain, verifyDomain } from "../api/domains.api";
import type { CustomDomain, DomainsOverview } from "../types";
import { SectionUnavailable } from "@/features/workspaces/settings/SectionUnavailable";

const pill = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";
const STATUS: Record<CustomDomain["status"], { label: string; className: string }> = {
  active: { label: "Live", className: "border-success/30 bg-success/10 text-success" },
  pending: { label: "Waiting for DNS", className: "border-warning/30 bg-warning/10 text-warning" },
  failed: { label: "Needs attention", className: "border-destructive/30 bg-destructive/10 text-destructive" },
};

function DomainRow({ workspaceId, domain, onChange, onRemoved }: { workspaceId: string; domain: CustomDomain; onChange: (d: CustomDomain) => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState<"verify" | "remove" | null>(null);
  const status = STATUS[domain.status];
  return (
    <li className="space-y-4 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{domain.hostname}</span>
          <span className={cn(pill, status.className)}>{status.label}</span>
        </span>
        <span className="flex items-center gap-2">
          {domain.status === "active" ? (
            <a href={domain.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
              Open <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("verify");
                try {
                  const next = await verifyDomain(workspaceId, domain.id);
                  onChange(next);
                  if (next.status === "active") toast.success(`${next.hostname} is live`);
                } catch (err) {
                  toast.error(getApiErrorMessage(err) ?? "The check did not run. Try again.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "verify" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Check DNS
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${domain.hostname}`}
            disabled={busy !== null}
            onClick={async () => {
              if (!window.confirm(`Remove ${domain.hostname}? Links on it stop working.`)) return;
              setBusy("remove");
              try {
                await removeDomain(workspaceId, domain.id);
                onRemoved();
                toast.success(`${domain.hostname} removed`);
              } catch (err) {
                toast.error(getApiErrorMessage(err) ?? "The domain could not be removed.");
                setBusy(null);
              }
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </span>
      </div>
      {domain.status !== "active" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Add these records at your DNS provider, then check again. Changes can take a while to show.</p>
          <div className="grid gap-3">
            {domain.records.map((record) => (
              <div key={record.type} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[auto_1fr_1fr] md:items-end">
                <span className={cn(pill, "w-fit self-center", record.found ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground")}>
                  {record.type} {record.found ? "found" : "missing"}
                </span>
                <CopyValue label="Name" value={record.host} />
                <CopyValue label="Value" value={record.value} />
              </div>
            ))}
          </div>
          {domain.error ? <p className="text-sm text-muted-foreground">{domain.error}.</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** /settings/domains: the workspace's custom domains for its participant pages (W4-E). */
export function DomainsSettings() {
  const { detail, failed: workspaceFailed, retry: retryWorkspace } = useCurrentWorkspace();
  const capabilities = useCapabilities();
  const [data, setData] = useState<(DomainsOverview & { id: string }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);

  const reason = !capabilities
    ? null
    : !capabilities.customDomains
      ? "Custom domains aren't enabled on this server."
      : detail && !detail.entitlements.features.custom_domains
        ? "Your plan doesn't include custom domains. They come with Enterprise."
        : detail && !detail.permissions.includes("workspace:domains")
          ? "Only owners and admins manage custom domains."
          : null;
  const workspaceId = detail && capabilities && !reason ? detail.workspace._id : null;

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    listDomains(workspaceId).then(
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
      title="Custom domains"
      description="Your audience joins and sees results on your own address, like polls.yourcompany.com."
    />
  );

  if (workspaceFailed) return <SettingsFailed message="This workspace could not be loaded." onRetry={retryWorkspace} />;
  if (!detail || !capabilities) return <SettingsLoading>Loading custom domains…</SettingsLoading>;
  if (reason) return <SectionUnavailable id="domains" title="Custom domains" description="Your audience joins and sees results on your own address." />;
  if (failed) return <SettingsFailed message="Custom domains could not be loaded." onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data || data.id !== workspaceId) return <SettingsLoading>Loading custom domains…</SettingsLoading>;

  const replace = (next: CustomDomain) => setData({ ...data, domains: data.domains.map((d) => (d.id === next.id ? next : d)) });

  return (
    <div className="space-y-8">
      {header}
      <form
        className={cn(settingsCard, "space-y-3")}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!hostname.trim()) return;
          setAdding(true);
          try {
            const created = await addDomain(workspaceId!, hostname.trim());
            setData({ ...data, domains: [...data.domains, created] });
            setHostname("");
          } catch (err) {
            toast.error(getApiErrorMessage(err) ?? "The domain could not be added.");
          } finally {
            setAdding(false);
          }
        }}
      >
        <Label htmlFor="custom-domain">Add a domain</Label>
        <p className="text-sm text-muted-foreground">
          Use a subdomain you own, like polls.yourcompany.com. It serves joining, live sessions, shared results and embeds;
          everything else stays on this site.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input id="custom-domain" placeholder="polls.yourcompany.com" value={hostname} onChange={(e) => setHostname(e.target.value)} className="h-9 max-w-sm bg-card" />
          <Button type="submit" disabled={adding || !hostname.trim()}>
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add domain
          </Button>
        </div>
      </form>
      {data.domains.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {data.domains.map((domain) => (
            <DomainRow
              key={domain.id}
              workspaceId={workspaceId!}
              domain={domain}
              onChange={replace}
              onRemoved={() => setData({ ...data, domains: data.domains.filter((d) => d.id !== domain.id) })}
            />
          ))}
        </ul>
      ) : null}
      {detail.entitlements.features.white_label ? (
        <p className="text-sm text-muted-foreground">Your plan includes white label: pages on your domains don&apos;t say &quot;Made with Open Poll&quot;.</p>
      ) : null}
    </div>
  );
}
