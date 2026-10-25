"use client";

import { useId, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AiDeckError } from "./AiDeckError";
import { validateForm, type DeckForm } from "./form";
import { DECK_LIMITS, DECK_TONES, SLIDE_CATEGORIES, type DeckError, type SlideCategory } from "./types";

const LANGUAGE_SUGGESTIONS = ["English", "Español", "Français", "Deutsch", "Português", "Italiano", "Nederlands", "हिन्दी", "日本語", "中文"];

interface AiDeckFormProps {
  form: DeckForm;
  onChange: (patch: Partial<DeckForm>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  error: DeckError | null;
  /** `capabilities.ai`; false means every step runs in labelled mock mode. */
  aiAvailable: boolean | null;
}

/** Step 1: what the deck is about. */
export function AiDeckForm({ form, onChange, onSubmit, onCancel, error, aiAvailable }: AiDeckFormProps) {
  const t = useTranslations("ai.deck");
  const ids = useId();
  const [submitted, setSubmitted] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(form.sourceText.length > 0);
  const errors = useMemo(() => validateForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  // Errors show after the first submit attempt, or for fields the author has touched and cleared.
  const show = (field: keyof typeof errors) => (submitted ? errors[field] : undefined);

  const submit = () => {
    setSubmitted(true);
    if (!hasErrors) onSubmit();
  };

  const errorText = (field: keyof typeof errors) => {
    const code = show(field);
    if (!code) return null;
    return t(`form.errors.${code}`, {
      min: DECK_LIMITS.topicMin,
      max: field === "topic" ? DECK_LIMITS.topicMax : field === "audience" ? DECK_LIMITS.audienceMax : DECK_LIMITS.sourceTextMax,
    });
  };

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {aiAvailable === false && (
        <p
          role="note"
          data-testid="ai-deck-mock-capability"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        >
          {t("mockCapability")}
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${ids}-topic`}>{t("form.topic")}</Label>
        <Textarea
          id={`${ids}-topic`}
          value={form.topic}
          placeholder={t("form.topicPlaceholder")}
          onChange={(event) => onChange({ topic: event.target.value })}
          aria-invalid={Boolean(show("topic"))}
          aria-describedby={show("topic") ? `${ids}-topic-error` : undefined}
          className="min-h-20 rounded-xl"
        />
        {show("topic") && (
          <p id={`${ids}-topic-error`} className="text-xs text-destructive">
            {errorText("topic")}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-audience`}>{t("form.audience")}</Label>
          <Input
            id={`${ids}-audience`}
            value={form.audience}
            placeholder={t("form.audiencePlaceholder")}
            onChange={(event) => onChange({ audience: event.target.value })}
            aria-invalid={Boolean(show("audience"))}
            className="rounded-xl"
          />
          {show("audience") && <p className="text-xs text-destructive">{errorText("audience")}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-language`}>{t("form.language")}</Label>
          <Input
            id={`${ids}-language`}
            value={form.language}
            list={`${ids}-languages`}
            onChange={(event) => onChange({ language: event.target.value })}
            aria-invalid={Boolean(show("language"))}
            className="rounded-xl"
          />
          <datalist id={`${ids}-languages`} aria-label={t("form.languageList")}>
            {LANGUAGE_SUGGESTIONS.map((language) => (
              <option key={language} value={language} />
            ))}
          </datalist>
          {show("language") && <p className="text-xs text-destructive">{errorText("language")}</p>}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${ids}-count`}>{t("form.slideCount")}</Label>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground" aria-hidden>
            {form.slideCount}
          </span>
        </div>
        <input
          id={`${ids}-count`}
          type="range"
          min={DECK_LIMITS.minSlides}
          max={DECK_LIMITS.maxSlides}
          step={1}
          value={form.slideCount}
          aria-valuetext={String(form.slideCount)}
          onChange={(event) => onChange({ slideCount: Number(event.target.value) })}
          className="accent-primary"
        />
      </div>

      <div className="grid gap-2" role="radiogroup" aria-label={t("form.tone")}>
        <span className="text-sm font-medium leading-none">{t("form.tone")}</span>
        <div className="flex flex-wrap gap-1.5">
          {DECK_TONES.map((tone) => {
            const selected = form.tone === tone;
            return (
              <button
                key={tone}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ tone })}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                  selected
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-secondary/20 text-muted-foreground hover:bg-secondary/50"
                )}
              >
                {t(`tones.${tone}`)}
              </button>
            );
          })}
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium leading-none">{t("form.include")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SLIDE_CATEGORIES.map((category: SlideCategory) => {
            const id = `${ids}-include-${category}`;
            return (
              <div key={category} className="flex items-start gap-3 rounded-xl border border-border bg-secondary/20 p-3">
                <Switch
                  id={id}
                  size="sm"
                  checked={form.include[category]}
                  onCheckedChange={(checked) => onChange({ include: { ...form.include, [category]: checked } })}
                  className="mt-0.5"
                />
                <label htmlFor={id} className="grid cursor-pointer gap-0.5">
                  <span className="text-sm font-medium leading-none">{t(`includes.${category}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`includes.${category}Hint`)}</span>
                </label>
              </div>
            );
          })}
        </div>
        {show("include") && <p className="text-xs text-destructive">{errorText("include")}</p>}
      </fieldset>

      <div className="grid gap-2">
        <button
          type="button"
          aria-expanded={sourceOpen}
          aria-controls={`${ids}-source`}
          onClick={() => setSourceOpen((open) => !open)}
          className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("form.sourceText")}
        </button>
        {sourceOpen && (
          <div id={`${ids}-source`} className="grid gap-2">
            <Textarea
              aria-label={t("form.sourceText")}
              value={form.sourceText}
              onChange={(event) => onChange({ sourceText: event.target.value })}
              aria-invalid={Boolean(show("sourceText"))}
              className="min-h-32 rounded-xl text-sm"
            />
            <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
              <p>{t("form.sourceHint")}</p>
              <span className={cn("shrink-0 tabular-nums", form.sourceText.length > DECK_LIMITS.sourceTextMax && "text-destructive")}>
                {t("form.sourceCounter", { count: form.sourceText.length, max: DECK_LIMITS.sourceTextMax })}
              </span>
            </div>
            {show("sourceText") && <p className="text-xs text-destructive">{errorText("sourceText")}</p>}
          </div>
        )}
      </div>

      {error && <AiDeckError error={error} />}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="rounded-xl" onClick={onCancel}>
          {t("planning.cancel")}
        </Button>
        <Button type="submit" className="rounded-xl bg-primary font-medium text-primary-foreground hover:opacity-90">
          <Sparkles className="mr-1.5 size-4" aria-hidden />
          {t("form.submit")}
        </Button>
      </div>
    </form>
  );
}
