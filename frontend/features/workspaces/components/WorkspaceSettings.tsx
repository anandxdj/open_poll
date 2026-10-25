"use client";

import { useState } from "react";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api-error";
import { SettingsHeading, settingsCard } from "../settings/blocks";
import { updateWorkspace } from "../api/workspaces.api";
import { useCapabilities, useCurrentWorkspace, useSwitchWorkspace } from "../hooks/useWorkspaces";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { PLAN_NAMES, ROLE_NAMES, type PlanFeature, type PlanLimit, type WorkspaceDetail } from "../types";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

const LIMIT_ROWS: { key: PlanLimit; label: string; unit?: string }[] = [
  { key: "audienceCap", label: "Participants per live session" },
  { key: "seats", label: "Members" },
  { key: "aiDecksPerMonth", label: "AI-generated decks", unit: "per month" },
  { key: "importsPerMonth", label: "Imports", unit: "per month" },
  { key: "retentionDays", label: "Longest data retention", unit: "days" },
  { key: "auditRetentionDays", label: "Audit log history", unit: "days" },
];

const FEATURE_ROWS: { key: PlanFeature; label: string }[] = [
  { key: "export_csv", label: "CSV export" },
  { key: "export_xlsx", label: "Excel export" },
  { key: "export_pdf", label: "PDF export" },
  { key: "brand_kits", label: "Brand kits" },
  { key: "sso", label: "Single sign-on" },
  { key: "scim", label: "SCIM provisioning" },
  { key: "custom_domains", label: "Custom domains" },
  { key: "white_label", label: "White label" },
];



function ReadOnlyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div
        className={
          "rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground" + (mono ? " font-mono" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}

function GeneralSection({ detail }: { detail: WorkspaceDetail }) {
  const canManage = detail.permissions.includes("workspace:manage");
  const [name, setName] = useState(detail.workspace.name);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const dirty = trimmed !== detail.workspace.name;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed || !dirty) return;
    setSaving(true);
    try {
      const updated = await updateWorkspace(detail.workspace._id, { name: trimmed });
      useWorkspaceStore.getState().setCurrent(updated);
      setName(updated.workspace.name);
      toast.success("Workspace renamed");
    } catch (error) {
      toast.error(getApiErrorMessage(error) ?? "Could not save the workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <SettingsHeading title="Workspace" description="Everything you create here is shared with this workspace's members." />
      <form onSubmit={(event) => void save(event)} className={`${settingsCard} space-y-6`}>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="workspace-name-setting">Name</Label>
            <Input
              id="workspace-name-setting"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              disabled={!canManage || saving}
             
            />
          </div>
          {canManage ? (
            <Button type="submit" disabled={saving || !trimmed || !dirty}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          ) : null}
        </div>
        {!canManage ? (
          <p className="text-xs text-muted-foreground">Only owners and admins can rename the workspace.</p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <ReadOnlyField label="Type" value={detail.workspace.type === "personal" ? "Personal" : "Team"} />
          <ReadOnlyField label="Your role" value={ROLE_NAMES[detail.membership.role]} />
          <ReadOnlyField label="Slug" value={detail.workspace.slug} mono />
        </div>
      </form>
    </section>
  );
}

function formatLimit(value: number | null, unit?: string) {
  if (value === null) return "Unlimited";
  return unit ? `${value.toLocaleString()} ${unit}` : value.toLocaleString();
}

function PlanSection({ detail }: { detail: WorkspaceDetail }) {
  const capabilities = useCapabilities();
  const { entitlements } = detail;

  return (
    <section className="space-y-6">
      <SettingsHeading
        title={`${PLAN_NAMES[entitlements.plan]} plan`}
        description={
          capabilities?.billing
            ? "Limits and features of this workspace's plan. Plans are changed under Billing."
            : "Limits and features of this workspace's plan. On this server, plans are assigned by an administrator."
        }
      />
      <div className={`${settingsCard} grid gap-8 md:grid-cols-2`}>
        <dl className="space-y-3">
          {LIMIT_ROWS.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-semibold text-foreground">{formatLimit(entitlements.limits[row.key], row.unit)}</dd>
            </div>
          ))}
        </dl>
        <ul className="space-y-2.5">
          {FEATURE_ROWS.map((row) => {
            const included = entitlements.features[row.key];
            return (
              <li
                key={row.key}
                className={"flex items-center gap-2 text-sm" + (included ? " text-foreground" : " text-muted-foreground")}
              >
                {included ? <Check className="size-4 text-accent-ink" /> : <Minus className="size-4 text-faint" />}
                {row.label}
                <span className="sr-only">{included ? "included" : "not included"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function TeamWorkspacesSection() {
  const [open, setOpen] = useState(false);
  const { switchTo } = useSwitchWorkspace();

  return (
    <section className="space-y-6">
      <SettingsHeading title="Team workspaces" description="Work with others in a separate workspace with its own plan." />
      <div className={`${settingsCard} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
        <p className="text-sm text-muted-foreground">
          New team workspaces start on the Free plan with one seat. Switch between workspaces from the sidebar.
        </p>
        <Button className="shrink-0" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Create team workspace
        </Button>
      </div>
      <CreateWorkspaceDialog open={open} onOpenChange={setOpen} onCreated={(created) => void switchTo(created.workspace._id)} />
    </section>
  );
}

/** Content of /settings/workspace: the current workspace's name, plan and team workspace creation. */
export function WorkspaceSettings() {
  const { detail, failed, retry } = useCurrentWorkspace();

  if (failed) {
    return (
      <div className={`${settingsCard} space-y-3`}>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this workspace.</p>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {/* Keyed so the name field resets when the workspace changes. */}
      <GeneralSection key={detail.workspace._id} detail={detail} />
      <PlanSection detail={detail} />
      <TeamWorkspacesSection />
    </div>
  );
}
