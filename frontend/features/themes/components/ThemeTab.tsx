"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, Palette } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { InspectorTabDef, InspectorTabProps } from "@/features/presentations/components/builder/inspectorTabs";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/useWorkspaces";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { saveDeckTheme } from "../api/themes.api";
import { contrastRatio } from "../contrast";
import { useThemeCatalog } from "../hooks/useThemeCatalog";
import { DEFAULT_PRESET_ID, type DeckThemeRef, type ThemeTokens } from "../types";
import { ThemeSwatch } from "./ThemeSwatch";

const optionClass =
  "group relative flex flex-col gap-2 rounded-lg border bg-card p-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring";

function ThemeOption({
  tokens,
  label,
  selected,
  disabled,
  onSelect,
}: {
  tokens: ThemeTokens;
  label: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(optionClass, selected ? "border-foreground" : "border-border hover:border-foreground/40")}
    >
      <ThemeSwatch tokens={tokens} />
      <span className="flex items-center justify-between gap-2 px-0.5">
        <span className="truncate">{label}</span>
        {selected ? <Check className="size-4 shrink-0 text-accent-ink" aria-hidden="true" /> : null}
      </span>
    </button>
  );
}

function AccentOverride({
  theme,
  base,
  busy,
  onSave,
}: {
  theme: DeckThemeRef;
  base: ThemeTokens | null;
  busy: boolean;
  onSave: (overrides: DeckThemeRef["overrides"]) => void;
}) {
  const on = Boolean(theme.overrides?.accent);
  const [accent, setAccent] = useState(theme.overrides?.accent ?? base?.colors.accent ?? "#f97316");
  const [accentText, setAccentText] = useState(theme.overrides?.accentText ?? base?.colors.accentText ?? "#1a0d04");
  const ratio = contrastRatio(accent, accentText);
  const readable = ratio >= 4.5;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="theme-accent-toggle" className="text-sm font-medium">
            Different accent for this deck
          </Label>
          <p className="text-sm text-muted-foreground">Buttons, bars and highlights on the stage and phones.</p>
        </div>
        <Switch
          id="theme-accent-toggle"
          checked={on}
          disabled={busy}
          onCheckedChange={(checked) => onSave(checked ? { accent, accentText } : null)}
        />
      </div>
      {on ? (
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">Accent</span>
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded-md border border-border bg-card"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">Text on accent</span>
            <input
              type="color"
              value={accentText}
              onChange={(e) => setAccentText(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded-md border border-border bg-card"
            />
          </label>
          <span
            className="inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold"
            style={{ backgroundColor: accent, color: accentText }}
          >
            Next
          </span>
          <p className={cn("text-sm", readable ? "text-muted-foreground" : "text-destructive")}>
            {ratio.toFixed(1)}:1 {readable ? "readable" : "too low, needs 4.5:1"}
          </p>
          <Button
            variant="outline"
            className="bg-card"
            disabled={busy || !readable || (accent === theme.overrides?.accent && accentText === theme.overrides?.accentText)}
            onClick={() => onSave({ accent, accentText })}
          >
            Apply accent
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Deck-level: the theme every live surface of this deck uses (preset, brand kit, accent). */
function ThemePanel({ deck, onDeckChange }: InspectorTabProps) {
  const { detail } = useCurrentWorkspace();
  const kitsAllowed = detail?.entitlements.features.brand_kits ?? false;
  const canManageKits = detail?.permissions.includes("workspace:brand") ?? false;
  const { catalog, kits, loading, failed, reload } = useThemeCatalog(kitsAllowed);
  const [busy, setBusy] = useState(false);

  if (!deck.id) {
    return <p className="text-sm text-muted-foreground">Save the deck first, then choose its theme here.</p>;
  }
  if (failed) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        Themes could not be loaded.
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (loading || !catalog) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading themes…
      </p>
    );
  }

  const theme: DeckThemeRef = deck.theme ?? { presetId: DEFAULT_PRESET_ID, brandKitId: null, overrides: null };
  const activeKit = theme.brandKitId ? kits.find((kit) => kit.id === theme.brandKitId) : undefined;
  const base = activeKit?.tokens ?? catalog.presets.find((p) => p.id === theme.presetId)?.tokens ?? null;

  const save = async (patch: Partial<DeckThemeRef>) => {
    setBusy(true);
    try {
      const saved = await saveDeckTheme(deck.id!, patch);
      onDeckChange({ theme: saved });
      toast.success("Theme saved");
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? "The theme could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="theme-presets-title" className="space-y-3">
        <div>
          <h3 id="theme-presets-title" className="text-sm font-semibold">
            Theme
          </h3>
          <p className="text-sm text-muted-foreground">
            How the projected screen looks and the accent on phones. Sessions keep the theme they started with.
          </p>
        </div>
        <div role="radiogroup" aria-labelledby="theme-presets-title" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {catalog.presets.map((preset) => (
            <ThemeOption
              key={preset.id}
              tokens={preset.tokens}
              label={preset.name}
              selected={!activeKit && theme.presetId === preset.id}
              disabled={busy}
              onSelect={() => void save({ presetId: preset.id, brandKitId: null })}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="theme-kits-title" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id="theme-kits-title" className="text-sm font-semibold">
            Brand kits
          </h3>
          {kitsAllowed && canManageKits ? (
            <Link href="/settings/brand" className="text-sm font-medium text-accent-ink underline-offset-4 hover:underline">
              Manage brand kits
            </Link>
          ) : null}
        </div>
        {!kitsAllowed ? (
          <p className="text-sm text-muted-foreground">
            Your own colours, fonts and logo come with the Pro plan.{" "}
            <Link href="/settings/billing" className="font-medium text-foreground underline underline-offset-4">
              See plans
            </Link>
          </p>
        ) : kits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No brand kits yet.{canManageKits ? " Create one under Settings, Brand." : " An admin can create one."}
          </p>
        ) : (
          <div role="radiogroup" aria-labelledby="theme-kits-title" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {kits.map((kit) => (
              <ThemeOption
                key={kit.id}
                tokens={kit.tokens}
                label={kit.name}
                selected={activeKit?.id === kit.id}
                disabled={busy}
                onSelect={() => void save({ brandKitId: kit.id })}
              />
            ))}
          </div>
        )}
      </section>

      <AccentOverride key={`${theme.presetId}:${theme.brandKitId}`} theme={theme} base={base} busy={busy} onSave={(overrides) => void save({ overrides })} />
    </div>
  );
}

export const themeTab: InspectorTabDef = {
  id: "theme",
  label: "Theme",
  Icon: Palette,
  order: 40,
  Panel: ThemePanel,
};
