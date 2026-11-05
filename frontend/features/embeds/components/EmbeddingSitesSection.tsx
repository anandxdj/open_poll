"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage } from "@/lib/api-error";
import { updateWorkspace } from "@/features/workspaces/api/workspaces.api";
import { SettingsHeading, settingsCard } from "@/features/workspaces/settings/blocks";
import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";
import type { WorkspaceDetail } from "@/features/workspaces/types";
import { MAX_EMBED_SITES, normalizeSite } from "../sites";

/**
 * Settings → Workspace → Embedding (W4-D): the sites that may show this
 * workspace's embeds (`settings.embedAllowedOrigins`, `workspace:manage`).
 * None listed = any site. Each deck still has to allow embedding itself.
 */
export function EmbeddingSitesSection({ detail }: { detail: WorkspaceDetail }) {
  const canManage = detail.permissions.includes("workspace:manage");
  const sites = detail.workspace.settings.embedAllowedOrigins ?? [];
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (next: string[], message: string) => {
    setSaving(true);
    try {
      const updated = await updateWorkspace(detail.workspace._id, { settings: { embedAllowedOrigins: next } });
      useWorkspaceStore.getState().setCurrent(updated);
      toast.success(message);
      return true;
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't save the sites");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const site = normalizeSite(draft);
    if (!site) {
      setError("Enter a site address like https://example.com (https://*.example.com for every subdomain).");
      return;
    }
    if (sites.includes(site)) {
      setError("That site is already on the list.");
      return;
    }
    setError(null);
    if (await save([...sites, site], "Site added")) setDraft("");
  };

  return (
    <section id="embedding" aria-labelledby="embedding-title" className="scroll-mt-20 space-y-6">
      <SettingsHeading
        id="embedding-title"
        title="Embedding"
        description="Sites that may show this workspace's embedded presentations, stages and results. Each deck still has to allow embedding."
      />
      <div className={`${settingsCard} space-y-4`}>
        <p className="text-sm text-muted-foreground" role="status">
          {sites.length === 0 ? "Any site may embed. Add a site to allow only the sites you list." : `Only these ${sites.length === 1 ? "site" : `${sites.length} sites`} may embed:`}
        </p>
        {sites.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Sites allowed to embed">
            {sites.map((site) => (
              <li key={site} className="flex items-center gap-1 rounded-full border border-border bg-secondary/60 py-1 pl-3 pr-1 font-mono text-xs">
                {site}
                {canManage ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save(sites.filter((s) => s !== site), "Site removed")}
                    aria-label={`Remove ${site}`}
                    className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canManage ? (
          sites.length < MAX_EMBED_SITES ? (
            <form onSubmit={(event) => void add(event)} className="space-y-1.5">
              <label htmlFor="embed-site" className="text-xs font-medium text-muted-foreground">
                Add a site
              </label>
              <div className="flex gap-2">
                <Input
                  id="embed-site"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setError(null);
                  }}
                  placeholder="https://intranet.example.com"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "embed-site-error" : undefined}
                  className="bg-card font-mono text-sm"
                />
                <Button type="submit" variant="outline" className="shrink-0 bg-card" disabled={saving || !draft.trim()}>
                  {saving ? <Loader2 className="animate-spin" /> : <Plus />}
                  Add
                </Button>
              </div>
              {error ? (
                <p id="embed-site-error" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">You can list up to {MAX_EMBED_SITES} sites.</p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>
        )}
      </div>
    </section>
  );
}
