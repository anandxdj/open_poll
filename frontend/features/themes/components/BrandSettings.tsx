"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { updateWorkspace } from "@/features/workspaces/api/workspaces.api";
import { useCapabilities, useCurrentWorkspace } from "@/features/workspaces/hooks/useWorkspaces";
import { selectClass } from "@/features/workspaces/members/components/RoleSelect";
import {
  SettingsFailed,
  SettingsHeading,
  SettingsLoading,
  SettingsRow,
  settingsCard,
  settingsList,
} from "@/features/workspaces/settings/blocks";
import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";
import type { WorkspaceDetail } from "@/features/workspaces/types";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { deleteBrandKit } from "../api/themes.api";
import { useThemeCatalog } from "../hooks/useThemeCatalog";
import { DEFAULT_PRESET_ID, type BrandKit, type BrandKitInput, type ThemeCatalog } from "../types";
import { BrandKitEditor } from "./BrandKitEditor";
import { ThemeSwatch } from "./ThemeSwatch";

/** A new kit starts from the default preset's palette, so it is readable before any change. */
function newKitFrom(catalog: ThemeCatalog): BrandKitInput {
  const base = catalog.presets.find((p) => p.id === DEFAULT_PRESET_ID) ?? catalog.presets[0]!;
  return {
    name: "",
    colors: { ...base.tokens.colors, chart: [...base.tokens.colors.chart] },
    fonts: { heading: "System", body: "System" },
    logo: null,
    background: null,
  };
}

const toInput = (kit: BrandKit): BrandKitInput => ({
  name: kit.name,
  colors: { ...kit.colors, chart: [...kit.colors.chart] },
  fonts: { ...kit.fonts },
  logo: kit.logo,
  background: kit.background,
});

type DefaultTheme = { presetId: string; brandKitId: string | null } | null;

function DefaultThemeRow({ detail, catalog, kits }: { detail: WorkspaceDetail; catalog: ThemeCatalog; kits: BrandKit[] }) {
  const stored = detail.workspace.settings.defaultTheme as DefaultTheme;
  const value = stored?.brandKitId ? `kit:${stored.brandKitId}` : `preset:${stored?.presetId ?? DEFAULT_PRESET_ID}`;
  const [saving, setSaving] = useState(false);

  async function save(next: string) {
    setSaving(true);
    const [kind, id] = next.split(":") as ["kit" | "preset", string];
    const defaultTheme =
      kind === "kit" ? { presetId: stored?.presetId ?? DEFAULT_PRESET_ID, brandKitId: id } : { presetId: id, brandKitId: null };
    try {
      const updated = await updateWorkspace(detail.workspace._id, { settings: { defaultTheme } });
      useWorkspaceStore.getState().setCurrent(updated);
      toast.success("Default theme saved");
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? "The default theme could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={settingsList}>
      <SettingsRow
        label="Theme for new decks"
        htmlFor="default-theme"
        description="Each deck can still pick its own in the builder's Theme tab."
      >
        <select id="default-theme" value={value} disabled={saving} onChange={(e) => void save(e.target.value)} className={selectClass}>
          <optgroup label="Brand kits">
            {kits.map((kit) => (
              <option key={kit.id} value={`kit:${kit.id}`}>
                {kit.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Built-in themes">
            {catalog.presets.map((preset) => (
              <option key={preset.id} value={`preset:${preset.id}`}>
                {preset.name}
              </option>
            ))}
          </optgroup>
        </select>
      </SettingsRow>
    </div>
  );
}

function KitCard({ kit, onEdit, onDelete }: { kit: BrandKit; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <ThemeSwatch tokens={kit.tokens} />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{kit.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {kit.fonts.heading === "System" ? "System font" : kit.fonts.heading}
            {kit.logo ? ", logo" : ""}
            {kit.background ? ", background" : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${kit.name}`} onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${kit.name}`} onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}

/** /settings/brand: the workspace's brand kits and the theme new decks start with (W3-A). */
export function BrandSettings() {
  const { detail, failed: workspaceFailed, retry } = useCurrentWorkspace();
  const capabilities = useCapabilities();
  const allowed = detail?.entitlements.features.brand_kits ?? false;
  const canManage = detail?.permissions.includes("workspace:brand") ?? false;
  const { catalog, kits, loading, failed, reload } = useThemeCatalog(allowed && canManage);
  const [editing, setEditing] = useState<BrandKit | "new" | null>(null);
  const [removing, setRemoving] = useState<BrandKit | null>(null);
  const [busy, setBusy] = useState(false);

  const header = (
    <SettingsHeading
      title="Brand"
      description="Your colours, fonts and logo on the projected screen and the audience's phones."
    />
  );

  if (workspaceFailed) return <SettingsFailed message="This workspace could not be loaded." onRetry={retry} />;
  if (!detail) return <SettingsLoading>Loading brand settings…</SettingsLoading>;
  if (!allowed || !canManage) {
    return (
      <div className="space-y-6">
        {header}
        <div className={cn(settingsCard, "space-y-3")}>
          <p className="text-sm text-muted-foreground">
            {!allowed
              ? "Brand kits come with the Pro, Team and Enterprise plans."
              : "Only owners and admins can manage brand kits. Every member can pick one for a deck in the builder."}
          </p>
          {!allowed && detail.permissions.includes("workspace:billing") ? (
            <Link href="/settings/billing" className={cn(buttonVariants({ variant: "outline" }), "bg-card")}>
              See plans
            </Link>
          ) : null}
        </div>
      </div>
    );
  }
  if (failed) return <SettingsFailed message="Brand kits could not be loaded." onRetry={reload} />;
  if (loading || !catalog) return <SettingsLoading>Loading brand kits…</SettingsLoading>;

  if (editing) {
    return (
      <div className="space-y-6">
        <SettingsHeading
          title={editing === "new" ? "New brand kit" : `Edit ${editing.name}`}
          description="Colours must stay readable on a projector: the checks below follow WCAG AA."
        />
        <BrandKitEditor
          kit={editing === "new" ? null : editing}
          initial={editing === "new" ? newKitFrom(catalog) : toInput(editing)}
          fonts={catalog.fonts}
          storage={capabilities?.storage ?? false}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  async function confirmDelete(kit: BrandKit) {
    setBusy(true);
    try {
      await deleteBrandKit(kit.id);
      toast.success(`${kit.name} deleted`);
      reload();
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? "The brand kit could not be deleted.");
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-12">
      <section aria-labelledby="brand-kits-title" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SettingsHeading
            id="brand-kits-title"
            title="Brand kits"
            description="Decks pick a kit in the builder's Theme tab. Sessions keep the look they started with."
          />
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New brand kit
          </Button>
        </div>
        {kits.length === 0 ? (
          <div className={cn(settingsCard, "text-sm text-muted-foreground")}>
            No brand kits yet. Create one with your colours, fonts and logo.
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {kits.map((kit) => (
              <KitCard key={kit.id} kit={kit} onEdit={() => setEditing(kit)} onDelete={() => setRemoving(kit)} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="default-theme-title" className="space-y-5">
        <SettingsHeading id="default-theme-title" title="New decks" />
        <DefaultThemeRow key={JSON.stringify(detail.workspace.settings.defaultTheme)} detail={detail} catalog={catalog} kits={kits} />
      </section>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !busy && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold">Delete {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Decks using it go back to their built-in theme. Past sessions keep the look they had.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-3">
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <Button
              disabled={busy}
              onClick={() => removing && void confirmDelete(removing)}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete brand kit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
