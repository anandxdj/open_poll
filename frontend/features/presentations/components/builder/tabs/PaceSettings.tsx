"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Gauge, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api-client";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { DeckSettings, ResultsVisibility } from "../../../types";
import type { InspectorTabDef } from "../inspectorTabs";

type ApiOk<T> = { success: boolean; message: string; data: T };
type Pace = "presenter" | "audience";
type Nickname = DeckSettings["nickname"];

/** What this tab edits: the deck's pace and its audience-pace settings (W2-F), and the nickname rule. */
export interface PaceSettingsValue {
  pace: Pace;
  nickname: Nickname;
  resultsVisibility: ResultsVisibility;
  closeAfterMinutes: number | null;
  assessment: { enabled: boolean; passingScorePercentage: number; maxAttempts: number | null };
}

export const DEFAULT_PACE_SETTINGS: PaceSettingsValue = {
  pace: "presenter",
  nickname: "required",
  resultsVisibility: "after_close",
  closeAfterMinutes: null,
  assessment: { enabled: false, passingScorePercentage: 70, maxAttempts: 1 },
};

/** Limits mirrored from the backend deck settings schema. */
export const MAX_ATTEMPTS = 10;
export const MAX_CLOSE_AFTER_MINUTES = 43200;

type DeckResponse = { pace?: Pace; settings?: Partial<DeckSettings> };

/** Reads the stored deck into the tab's value, defaulting what is missing (decks saved before W2-F). */
export function paceSettingsFrom(deck: DeckResponse): PaceSettingsValue {
  const paced = deck.settings?.audiencePaced;
  const assessment = paced?.assessment;
  return {
    pace: deck.pace === "audience" ? "audience" : "presenter",
    nickname: deck.settings?.nickname ?? DEFAULT_PACE_SETTINGS.nickname,
    resultsVisibility: paced?.resultsVisibility ?? DEFAULT_PACE_SETTINGS.resultsVisibility,
    closeAfterMinutes: paced?.closeAfterMinutes ?? null,
    assessment: {
      enabled: assessment?.enabled ?? false,
      passingScorePercentage: assessment?.passingScorePercentage ?? 70,
      maxAttempts: assessment?.maxAttempts === undefined ? 1 : assessment.maxAttempts,
    },
  };
}

/** A whole number within [min, max], or null when the text is not one. */
export function parseBounded(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

const labelClass = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/60";

const PACES: { value: Pace; title: string; hint: string }[] = [
  { value: "presenter", title: "Presenter pace", hint: "You move everyone through the slides together, with timers and a live leaderboard." },
  {
    value: "audience",
    title: "Audience pace",
    hint: "Every question opens at once and each person goes through the slides on their own. No timers, no speed points.",
  },
];

const VISIBILITY: { value: ResultsVisibility; label: string }[] = [
  { value: "after_submit", label: "After each answer" },
  { value: "after_close", label: "When you close the questions" },
  { value: "never", label: "Never" },
];

const NICKNAMES: { value: Nickname; label: string; hint: string }[] = [
  { value: "required", label: "Required", hint: "Everyone picks a nickname to join." },
  { value: "optional", label: "Optional", hint: "People without one join as “Guest 1234”." },
  { value: "off", label: "Off", hint: "Everyone joins as a guest." },
];

/**
 * Builder tab "Pace" (W2-F): presenter pace or audience pace, and for audience
 * pace when results show on phones, an optional closing time (minutes after
 * opening), and the assessment (pass mark, attempts); plus the deck's nickname
 * rule. Each change saves on its own with `PATCH /presentations/:id` (like the
 * Audience and Theme tabs: no revision change) and applies to the next session.
 */
function PacePanel() {
  const deckId = useSearchParams()?.get("id") ?? null;
  const [value, setValue] = useState<PaceSettingsValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Text of the number fields while typed; saved on blur when valid.
  const [drafts, setDrafts] = useState<{ pass?: string; attempts?: string; minutes?: string }>({});

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    void apiClient
      .get<ApiOk<DeckResponse>>(`/presentations/${deckId}`)
      .then((res) => {
        if (!cancelled) setValue(paceSettingsFrom(res.data.data));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err) ?? "Could not load the pace settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  if (!deckId) {
    return (
      <p className="rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground/60">
        Save the deck first. Then choose how people go through it here.
      </p>
    );
  }
  if (!value) {
    return error ? (
      <p role="alert" className="text-xs text-red-400">
        {error}
      </p>
    ) : (
      <Loader2 className="mx-auto size-5 animate-spin text-primary/60" aria-label="Loading pace settings" />
    );
  }

  const apply = async (next: PaceSettingsValue, body: Record<string, unknown>) => {
    const previous = value;
    setValue(next);
    setError(null);
    setSaving(true);
    try {
      await apiClient.patch(`/presentations/${deckId}`, body);
    } catch (err: unknown) {
      setValue(previous);
      setError(getApiErrorMessage(err) ?? "Could not save the pace settings.");
    } finally {
      setSaving(false);
    }
  };

  const setPaced = (patch: Partial<Omit<PaceSettingsValue, "pace" | "nickname" | "assessment">>) =>
    apply({ ...value, ...patch }, { settings: { audiencePaced: patch } });
  const setAssessment = (patch: Partial<PaceSettingsValue["assessment"]>) =>
    apply({ ...value, assessment: { ...value.assessment, ...patch } }, { settings: { audiencePaced: { assessment: patch } } });

  const commitNumber = (key: "pass" | "attempts" | "minutes") => {
    const text = drafts[key];
    if (text === undefined) return;
    setDrafts((d) => ({ ...d, [key]: undefined }));
    if (key === "pass") {
      const pass = parseBounded(text, 0, 100);
      if (pass === null) return setError("The pass mark is a whole number from 0 to 100.");
      if (pass !== value.assessment.passingScorePercentage) void setAssessment({ passingScorePercentage: pass });
    } else if (key === "attempts") {
      const attempts = parseBounded(text, 1, MAX_ATTEMPTS);
      if (attempts === null) return setError(`Attempts are a whole number from 1 to ${MAX_ATTEMPTS}.`);
      if (attempts !== value.assessment.maxAttempts) void setAssessment({ maxAttempts: attempts });
    } else {
      const minutes = parseBounded(text, 1, MAX_CLOSE_AFTER_MINUTES);
      if (minutes === null) return setError(`The closing time is a whole number of minutes from 1 to ${MAX_CLOSE_AFTER_MINUTES}.`);
      if (minutes !== value.closeAfterMinutes) void setPaced({ closeAfterMinutes: minutes });
    }
  };

  const audience = value.pace === "audience";
  return (
    <div className="space-y-8">
      <fieldset className="space-y-3">
        <legend className={labelClass}>Pace</legend>
        <div role="radiogroup" aria-label="Pace" className="space-y-2">
          {PACES.map((option) => {
            const checked = value.pace === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => !checked && void apply({ ...value, pace: option.value }, { pace: option.value })}
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  checked ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:border-foreground/40"
                )}
              >
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="block text-xs text-muted-foreground/60">{option.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {audience && (
        <>
          <fieldset className="space-y-3">
            <legend className={labelClass}>Results on phones</legend>
            <div role="radiogroup" aria-label="Results on phones" className="flex flex-wrap gap-2">
              {VISIBILITY.map((option) => {
                const checked = value.resultsVisibility === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => !checked && void setPaced({ resultsVisibility: option.value })}
                    className={cn(
                      "min-h-10 rounded-full border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                      checked ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-card hover:border-foreground/40"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className={labelClass}>Closing time</legend>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="pace-close-after" className="text-sm font-semibold">
                  Close automatically
                </Label>
                <p className="text-xs text-muted-foreground/50">
                  The questions close this many minutes after you open them. You can still change the time when you open them.
                </p>
              </div>
              <Switch
                id="pace-close-after"
                checked={value.closeAfterMinutes !== null}
                onCheckedChange={(on) => void setPaced({ closeAfterMinutes: on ? 60 : null })}
              />
            </div>
            {value.closeAfterMinutes !== null && (
              <div className="flex items-center gap-2">
                <Input
                  id="pace-close-minutes"
                  inputMode="numeric"
                  aria-label="Minutes after opening"
                  className="h-10 w-28 bg-card tabular-nums"
                  value={drafts.minutes ?? String(value.closeAfterMinutes)}
                  onChange={(e) => setDrafts((d) => ({ ...d, minutes: e.target.value }))}
                  onBlur={() => commitNumber("minutes")}
                  onKeyDown={(e) => e.key === "Enter" && commitNumber("minutes")}
                />
                <span className="text-sm text-muted-foreground/70">minutes after opening</span>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-4">
            <legend className={labelClass}>Assessment</legend>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="pace-assessment" className="text-sm font-semibold">
                  Grade it as an assessment
                </Label>
                <p className="text-xs text-muted-foreground/50">
                  Graded questions count towards a score; each person passes or fails at the pass mark and may try again.
                </p>
              </div>
              <Switch
                id="pace-assessment"
                checked={value.assessment.enabled}
                onCheckedChange={(enabled) => void setAssessment({ enabled })}
              />
            </div>
            {value.assessment.enabled && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pace-pass-mark" className="text-sm font-semibold">
                    Pass mark (%)
                  </Label>
                  <Input
                    id="pace-pass-mark"
                    inputMode="numeric"
                    className="h-10 bg-card tabular-nums"
                    value={drafts.pass ?? String(value.assessment.passingScorePercentage)}
                    onChange={(e) => setDrafts((d) => ({ ...d, pass: e.target.value }))}
                    onBlur={() => commitNumber("pass")}
                    onKeyDown={(e) => e.key === "Enter" && commitNumber("pass")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pace-attempts" className="text-sm font-semibold">
                    Attempts
                  </Label>
                  <Input
                    id="pace-attempts"
                    inputMode="numeric"
                    className="h-10 bg-card tabular-nums"
                    disabled={value.assessment.maxAttempts === null}
                    value={value.assessment.maxAttempts === null ? "" : (drafts.attempts ?? String(value.assessment.maxAttempts))}
                    placeholder="Unlimited"
                    onChange={(e) => setDrafts((d) => ({ ...d, attempts: e.target.value }))}
                    onBlur={() => commitNumber("attempts")}
                    onKeyDown={(e) => e.key === "Enter" && commitNumber("attempts")}
                  />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground/70">
                    <input
                      type="checkbox"
                      checked={value.assessment.maxAttempts === null}
                      onChange={(e) => void setAssessment({ maxAttempts: e.target.checked ? null : 3 })}
                      className="size-4 accent-primary"
                    />
                    Unlimited attempts
                  </label>
                </div>
              </div>
            )}
          </fieldset>
        </>
      )}

      <fieldset className="space-y-3">
        <legend className={labelClass}>Nicknames</legend>
        <div role="radiogroup" aria-label="Nicknames" className="space-y-2">
          {NICKNAMES.map((option) => {
            const checked = value.nickname === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => !checked && void apply({ ...value, nickname: option.value }, { settings: { nickname: option.value } })}
                className={cn(
                  "flex w-full items-baseline justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  checked ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:border-foreground/40"
                )}
              >
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs text-muted-foreground/60">{option.hint}</span>
              </button>
            );
          })}
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

export const paceTab: InspectorTabDef = {
  id: "pace",
  label: "Pace",
  Icon: Gauge,
  order: 35,
  Panel: PacePanel,
};
