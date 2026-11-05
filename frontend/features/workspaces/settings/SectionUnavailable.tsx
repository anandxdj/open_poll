"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Loader2, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FALLBACK_CATALOG } from "@/features/billing/lib/catalog";
import { cn } from "@/lib/utils";
import { CreateWorkspaceDialog } from "../components/CreateWorkspaceDialog";
import { useCapabilities, useCurrentWorkspace, useSwitchWorkspace, useWorkspaces } from "../hooks/useWorkspaces";
import { ROLE_ORDER } from "../members/roles";
import type { WorkspaceSummary } from "../types";
import { SettingsHeading, settingsCard } from "./blocks";
import { SETTINGS_SECTIONS, resolveSection, type SettingsSection, type SettingsSectionId } from "./sections";

/**
 * Whether a section would open in another of the user's workspaces, judged
 * from its type, its plan's default features and the user's role there.
 */
export function openableIn(section: SettingsSection, workspace: WorkspaceSummary): boolean {
  if (section.teamOnly && workspace.type !== "team") return false;
  if (section.feature) {
    const plan = FALLBACK_CATALOG.plans.find((p) => p.id === workspace.plan);
    if (!plan?.features[section.feature]) return false;
  }
  if (section.action && ROLE_ORDER.indexOf(workspace.role) > ROLE_ORDER.indexOf(section.action.minimumRole)) return false;
  return true;
}

/**
 * What a settings page shows when its section is locked here: why, and the
 * way forward: switch to a workspace where it opens, create a team workspace,
 * or see the plans. Server-level reasons (a feature the deployment has off)
 * get the reason alone.
 */
export function SectionUnavailable({ id, title, description }: { id: SettingsSectionId; title: string; description?: string }) {
  const section = SETTINGS_SECTIONS.find((s) => s.id === id)!;
  const capabilities = useCapabilities();
  const { detail } = useCurrentWorkspace();
  const { workspaces, currentWorkspaceId } = useWorkspaces();
  const { switchTo, switchingTo } = useSwitchWorkspace();
  const [creating, setCreating] = useState(false);

  const { reason } = resolveSection(section, { capabilities, workspace: detail });
  const serverOff = Boolean(section.capability && capabilities && !capabilities[section.capability.key]);
  const elsewhere = serverOff ? [] : workspaces.filter((w) => w._id !== currentWorkspaceId && openableIn(section, w));
  const needsTeam = !serverOff && section.teamOnly && detail?.workspace.type !== "team";
  const needsPlan = !serverOff && section.feature && detail && !detail.entitlements.features[section.feature];
  const canSeePlans = detail?.permissions.includes("workspace:billing") ?? false;

  return (
    <div className="space-y-6">
      <SettingsHeading title={title} description={description} />
      <div className={cn(settingsCard, "space-y-4")}>
        <p className="text-sm text-foreground">{reason ?? "This isn't available here."}</p>
        {elsewhere.length ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">It opens in {elsewhere.length === 1 ? "your other workspace" : "these workspaces"}:</p>
            <div className="flex flex-wrap gap-2">
              {elsewhere.map((workspace) => (
                <Button key={workspace._id} variant="outline" className="bg-card" disabled={switchingTo !== null} onClick={() => void switchTo(workspace._id)}>
                  {switchingTo === workspace._id ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
                  Switch to {workspace.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {needsTeam || (needsPlan && canSeePlans) ? (
          <div className="flex flex-wrap gap-2">
            {needsTeam ? (
              <Button variant={elsewhere.length ? "outline" : "default"} className={elsewhere.length ? "bg-card" : undefined} onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Create a team workspace
              </Button>
            ) : null}
            {needsPlan && canSeePlans && !needsTeam ? (
              <Link href="/settings/billing" className={cn(buttonVariants({ variant: "outline" }), "bg-card")}>
                See plans
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreated={(created) => void switchTo(created.workspace._id)} />
    </div>
  );
}
