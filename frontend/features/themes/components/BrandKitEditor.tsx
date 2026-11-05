"use client";

import { useId, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { Check, Loader2, Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpload, type UploadPurpose } from "@/features/media/useUpload";
import { selectClass } from "@/features/workspaces/members/components/RoleSelect";
import { settingsCard } from "@/features/workspaces/settings/blocks";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { createBrandKit, updateBrandKit } from "../api/themes.api";
import { COLOR_LABELS, CONTRAST_RULES, HEX_COLOR, contrastFailures, contrastRatio, describeFailure } from "../contrast";
import type { BrandKit, BrandKitInput, ContrastFailure, ThemeColors, ThemeTokens } from "../types";
import { themeFont } from "../fonts";
import { BrandPreview } from "./BrandPreview";

const COLOR_FIELDS: (keyof Omit<ThemeColors, "chart">)[] = [
  "background",
  "surface",
  "text",
  "mutedText",
  "accent",
  "accentText",
  "correct",
  "incorrect",
];

const MAX_CHART = 12;

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const valid = HEX_COLOR.test(text);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={HEX_COLOR.test(value) ? value : "#000000"}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-card"
        />
        <Input
          id={id}
          value={text}
          spellCheck={false}
          aria-invalid={valid ? undefined : true}
          onChange={(e) => {
            setText(e.target.value);
            if (HEX_COLOR.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          className="h-9 bg-card font-mono text-sm uppercase"
        />
      </div>
    </div>
  );
}

function ImageField({
  label,
  description,
  purpose,
  url,
  storage,
  onChange,
}: {
  label: string;
  description: string;
  purpose: UploadPurpose;
  url: string;
  storage: boolean;
  onChange: (url: string) => void;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, uploading, error } = useUpload(purpose);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="url"
          placeholder="https://"
          value={url}
          onChange={(e) => onChange(e.target.value.trim())}
          className="h-9 min-w-0 flex-1 bg-card"
        />
        {storage ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              className="sr-only"
              tabIndex={-1}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const media = await upload(file);
                if (media) onChange(media.url);
              }}
            />
            <Button type="button" variant="outline" className="bg-card" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Upload
            </Button>
          </>
        ) : null}
        {url ? (
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange("")}>
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

const errorFailures = (err: unknown): ContrastFailure[] | null => {
  if (!isAxiosError<{ code?: string; details?: { failures?: ContrastFailure[] } }>(err)) return null;
  return err.response?.data?.code === "LOW_CONTRAST" ? (err.response.data.details?.failures ?? []) : null;
};

/**
 * Creates or edits a brand kit: name, the eight theme colours with their
 * contrast checked as you type, chart colours, fonts, logo and background
 * picture, beside a preview of the stage and a phone.
 */
export function BrandKitEditor({
  kit,
  initial,
  fonts,
  storage,
  onSaved,
  onCancel,
}: {
  /** The kit being edited; null creates a new one from `initial`. */
  kit: BrandKit | null;
  initial: BrandKitInput;
  fonts: string[];
  storage: boolean;
  onSaved: (kit: BrandKit) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState<BrandKitInput>(initial);
  const [saving, setSaving] = useState(false);
  const failures = contrastFailures(draft.colors);
  const setColor = (key: keyof Omit<ThemeColors, "chart">, value: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
  const chartValid = draft.colors.chart.length > 0 && draft.colors.chart.every((c) => HEX_COLOR.test(c));
  const canSave = !saving && draft.name.trim().length > 0 && failures.length === 0 && chartValid;

  const previewTokens: ThemeTokens = {
    presetId: "graph-paper",
    brandKitId: kit?.id ?? "preview",
    custom: true,
    name: draft.name,
    colors: draft.colors,
    fonts: { heading: themeFont(draft.fonts.heading), body: themeFont(draft.fonts.body) },
    logo: draft.logo,
    background: draft.background,
  };

  async function save() {
    setSaving(true);
    const payload: BrandKitInput = { ...draft, name: draft.name.trim() };
    try {
      const saved = kit ? await updateBrandKit(kit.id, payload) : await createBrandKit(payload);
      toast.success(kit ? "Brand kit saved" : "Brand kit created");
      onSaved(saved);
    } catch (err) {
      const server = errorFailures(err);
      toast.error(server?.length ? describeFailure(server[0]!) : (getApiErrorMessage(err) ?? "The brand kit could not be saved."));
      setSaving(false);
    }
  }

  return (
    <form
      id={formId}
      aria-label={kit ? `Edit ${kit.name}` : "New brand kit"}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save();
      }}
    >
      <div className={cn(settingsCard, "space-y-8")}>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-name`} className="text-sm font-medium">
            Name
          </Label>
          <Input
            id={`${formId}-name`}
            value={draft.name}
            maxLength={60}
            onChange={(e) => {
              const name = e.target.value;
              setDraft((d) => ({ ...d, name }));
            }}
            className="h-9 bg-card"
          />
        </div>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold tracking-[-0.01em]">Colours</legend>
          <p className="text-sm text-muted-foreground">The stage takes all of them; phones take the accent for their main buttons.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {COLOR_FIELDS.map((key) => (
              <ColorField
                key={key}
                id={`${formId}-${key}`}
                label={COLOR_LABELS[key]}
                value={draft.colors[key]}
                onChange={(value) => setColor(key, value)}
              />
            ))}
          </div>
          <ul aria-label="Contrast checks" className="grid gap-1.5 text-sm sm:grid-cols-2">
            {CONTRAST_RULES.map((rule) => {
              const ratio = contrastRatio(draft.colors[rule.foreground], draft.colors[rule.background]);
              const ok = ratio + 1e-9 >= rule.minimum;
              return (
                <li key={`${rule.foreground}-${rule.background}`} className={cn("flex items-center gap-2", ok ? "text-muted-foreground" : "text-destructive")}>
                  {ok ? <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" /> : <X className="size-3.5 shrink-0" aria-hidden="true" />}
                  {COLOR_LABELS[rule.foreground]} on {COLOR_LABELS[rule.background].toLowerCase()}: {ratio.toFixed(1)}:1
                  <span className="sr-only">{ok ? "passes" : `needs ${rule.minimum}:1`}</span>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold tracking-[-0.01em]">Chart colours</legend>
          <p className="text-sm text-muted-foreground">Bars and word clouds use them in this order.</p>
          <div className="flex flex-wrap items-center gap-2">
            {draft.colors.chart.map((color, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-1">
                <input
                  type="color"
                  aria-label={`Chart colour ${i + 1}`}
                  value={HEX_COLOR.test(color) ? color : "#000000"}
                  onChange={(e) => {
                    // Read now: the updater runs after React has put the controlled value back.
                    const value = e.target.value;
                    setDraft((d) => ({ ...d, colors: { ...d.colors, chart: d.colors.chart.map((c, j) => (j === i ? value : c)) } }));
                  }}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent"
                />
                {draft.colors.chart.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove chart colour ${i + 1}`}
                    onClick={() => setDraft((d) => ({ ...d, colors: { ...d.colors, chart: d.colors.chart.filter((_, j) => j !== i) } }))}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </span>
            ))}
            {draft.colors.chart.length < MAX_CHART ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="bg-card"
                onClick={() => setDraft((d) => ({ ...d, colors: { ...d.colors, chart: [...d.colors.chart, d.colors.accent] } }))}
              >
                <Plus className="size-3.5" /> Add
              </Button>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold tracking-[-0.01em]">Fonts</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["heading", "body"] as const).map((role) => (
              <div key={role} className="space-y-1.5">
                <Label htmlFor={`${formId}-font-${role}`} className="text-sm font-medium">
                  {role === "heading" ? "Headings" : "Body text"}
                </Label>
                <select
                  id={`${formId}-font-${role}`}
                  value={draft.fonts[role]}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraft((d) => ({ ...d, fonts: { ...d.fonts, [role]: value } }));
                  }}
                  className={cn(selectClass, "w-full")}
                >
                  {fonts.map((font) => (
                    <option key={font} value={font}>
                      {font === "System" ? "System (the app's font)" : font}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="text-base font-semibold tracking-[-0.01em]">Pictures</legend>
          <ImageField
            label="Logo"
            description="On the lobby screen and at the top of phones. PNG or WebP with a transparent background works best."
            purpose="brand_logo"
            url={draft.logo?.url ?? ""}
            storage={storage}
            onChange={(url) => setDraft((d) => ({ ...d, logo: url ? { url, alt: d.logo?.alt || d.name } : null }))}
          />
          <ImageField
            label="Stage background"
            description="Behind every stage screen, under the stage colour."
            purpose="brand_background"
            url={draft.background?.imageUrl ?? ""}
            storage={storage}
            onChange={(imageUrl) =>
              setDraft((d) => ({ ...d, background: imageUrl ? { imageUrl, overlayOpacity: d.background?.overlayOpacity ?? 0.6 } : null }))
            }
          />
          {draft.background ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-overlay`} className="text-sm font-medium">
                Stage colour over the picture: {Math.round(draft.background.overlayOpacity * 100)}%
              </Label>
              <input
                id={`${formId}-overlay`}
                type="range"
                min={0}
                max={90}
                step={5}
                value={Math.round(draft.background.overlayOpacity * 100)}
                onChange={(e) => {
                  const overlayOpacity = Number(e.target.value) / 100;
                  setDraft((d) => ({ ...d, background: d.background ? { ...d.background, overlayOpacity } : null }));
                }}
                className="w-full accent-[var(--primary)]"
              />
              <p className="text-sm text-muted-foreground">Keep it high enough for the text to stay readable over the picture.</p>
            </div>
          ) : null}
        </fieldset>
      </div>

      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <BrandPreview tokens={previewTokens} />
        {failures.length ? (
          <p role="status" className="text-sm text-destructive">
            {failures.length === 1 ? "One colour pair is" : `${failures.length} colour pairs are`} too hard to read. Fix{" "}
            {failures.length === 1 ? "it" : "them"} to save.
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={!canSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {kit ? "Save brand kit" : "Create brand kit"}
          </Button>
          <Button type="button" variant="outline" className="bg-card" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
