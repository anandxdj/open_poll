"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Smile } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { InspectorTabDef } from "@/features/presentations/components/builder/inspectorTabs";
import {
  getAudienceSettings,
  MAX_REACTION_EMOJIS,
  REACTION_CHOICES,
  saveAudienceSettings,
  type AudienceSettings,
} from "./settingsApi";

const labelClass = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/60";

type QnaKey = keyof AudienceSettings["qna"];

const QNA_TOGGLES: { key: QnaKey; label: string; hint: string }[] = [
  { key: "enabled", label: "Q&A during the whole session", hint: "Participants can ask any time. A Q&A slide opens it even when this is off." },
  { key: "moderation", label: "Review questions first", hint: "New questions wait for your approval before the audience sees them." },
  { key: "anonymousAllowed", label: "Allow anonymous questions", hint: "Participants can hide their nickname." },
  { key: "upvotes", label: "Allow upvotes", hint: "Participants vote for the questions they want answered." },
];

/** Deck-level audience settings: Q&A and reactions. Each change saves on its own. */
function AudiencePanel() {
  const deckId = useSearchParams()?.get("id") ?? null;
  const [settings, setSettings] = useState<AudienceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    void getAudienceSettings(deckId)
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err) ?? "Could not load the audience settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  if (!deckId) {
    return (
      <p className="rounded-2xl border border-white/5 bg-white/2 px-4 py-3 text-xs text-muted-foreground/60">
        Save the deck first. Then turn on Q&amp;A and reactions for the audience here.
      </p>
    );
  }
  if (!settings) {
    return error ? (
      <p role="alert" className="text-xs text-red-400">
        {error}
      </p>
    ) : (
      <Loader2 className="mx-auto size-5 animate-spin text-primary/60" aria-label="Loading audience settings" />
    );
  }

  const apply = async (next: AudienceSettings, patch: Parameters<typeof saveAudienceSettings>[1]) => {
    const previous = settings;
    setSettings(next);
    setError(null);
    setSaving(true);
    try {
      await saveAudienceSettings(deckId, patch);
    } catch (err: unknown) {
      setSettings(previous);
      setError(getApiErrorMessage(err) ?? "Could not save the audience settings.");
    } finally {
      setSaving(false);
    }
  };

  const setQna = (key: QnaKey, value: boolean) =>
    apply({ ...settings, qna: { ...settings.qna, [key]: value } }, { qna: { [key]: value } });

  const setReactionsEnabled = (enabled: boolean) =>
    apply({ ...settings, reactions: { ...settings.reactions, enabled } }, { reactions: { enabled } });

  const toggleEmoji = (emoji: string) => {
    const has = settings.reactions.emojis.includes(emoji);
    // Keep at least one emoji, and at most what the deck allows.
    if (has && settings.reactions.emojis.length === 1) return;
    if (!has && settings.reactions.emojis.length >= MAX_REACTION_EMOJIS) return;
    const emojis = has ? settings.reactions.emojis.filter((e) => e !== emoji) : [...settings.reactions.emojis, emoji];
    void apply({ ...settings, reactions: { ...settings.reactions, emojis } }, { reactions: { emojis } });
  };

  return (
    <div className="space-y-8">
      <fieldset className="space-y-4">
        <legend className={labelClass}>Questions &amp; answers</legend>
        {QNA_TOGGLES.map(({ key, label, hint }) => {
          const id = `audience-qna-${key}`;
          return (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor={id} className="text-sm font-semibold">
                  {label}
                </Label>
                <p className="text-xs text-muted-foreground/50">{hint}</p>
              </div>
              <Switch id={id} checked={settings.qna[key]} onCheckedChange={(value) => void setQna(key, value)} />
            </div>
          );
        })}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className={labelClass}>Reactions</legend>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="audience-reactions-enabled" className="text-sm font-semibold">
              Emoji reactions
            </Label>
            <p className="text-xs text-muted-foreground/50">Floating emoji on the stage while participants react.</p>
          </div>
          <Switch
            id="audience-reactions-enabled"
            checked={settings.reactions.enabled}
            onCheckedChange={(value) => void setReactionsEnabled(value)}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground/60">
            Pick up to {MAX_REACTION_EMOJIS} ({settings.reactions.emojis.length} chosen)
          </p>
          <div role="group" aria-label="Reaction emoji" className="flex flex-wrap gap-2">
            {REACTION_CHOICES.map((emoji) => {
              const chosen = settings.reactions.emojis.includes(emoji);
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`Reaction ${emoji}`}
                  disabled={!settings.reactions.enabled}
                  onClick={() => toggleEmoji(emoji)}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-xl border text-xl transition-colors disabled:opacity-40",
                    chosen ? "border-primary/50 bg-primary/15" : "border-white/10 bg-white/3 hover:bg-white/8"
                  )}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>
      </fieldset>

      <p className="text-[11px] text-muted-foreground/40" role="status">
        {saving ? "Saving…" : "Changes save as you make them and apply to the next session you start."}
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export const audienceTab: InspectorTabDef = {
  id: "audience",
  label: "Audience",
  Icon: Smile,
  order: 30,
  Panel: AudiencePanel,
};

