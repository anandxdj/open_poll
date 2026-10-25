"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AiDeckError } from "./AiDeckError";
import { MockDataNotice } from "./AiSourceNotice";
import { defaultNewKind, humanizeKind, isKnownKind } from "./kinds";
import {
  addSlide,
  countSlides,
  kindOptions,
  moveSlide,
  removeSlide,
  setOutlineTitle,
  setSectionTitle,
  slideNumber,
  updateSlide,
  validateOutline,
  type OutlineIssue,
} from "./outline";
import {
  DECK_LIMITS,
  type DeckError,
  type DeckInclude,
  type DeckKindInfo,
  type DeckOutline,
  type DeckSource,
  type DeckWarning,
} from "./types";

interface AiDeckOutlineProps {
  outline: DeckOutline;
  kinds: DeckKindInfo[];
  include: DeckInclude;
  source: DeckSource | null;
  warnings: DeckWarning[];
  error: DeckError | null;
  onChange: (outline: DeckOutline) => void;
  onBack: () => void;
  onSubmit: () => void;
}

const selectClass =
  "h-9 w-full min-w-0 rounded-xl border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const iconButtonClass =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30";

/** Step 2: review and edit the outline before any slide is written. */
export function AiDeckOutline({ outline, kinds, include, source, warnings, error, onChange, onBack, onSubmit }: AiDeckOutlineProps) {
  const t = useTranslations("ai.deck");
  const ids = useId();
  const [submitted, setSubmitted] = useState(false);
  const issues = useMemo(() => validateOutline(outline), [outline]);
  const total = countSlides(outline);
  const newKind = defaultNewKind(kinds, include);

  const kindLabel = (kind: string) => (isKnownKind(kind) ? t(`kinds.${kind}`) : humanizeKind(kind));

  const issueText = (issue: OutlineIssue) => {
    switch (issue.code) {
      case "title":
        return t("outline.errors.title");
      case "section":
        return t("outline.errors.section");
      case "intent":
        return t("outline.errors.intent", { number: issue.number });
      case "empty":
        return t("outline.errors.empty");
      case "tooMany":
        return t("outline.errors.tooMany", { max: DECK_LIMITS.maxSlides });
    }
  };

  const submit = () => {
    setSubmitted(true);
    if (issues.length === 0) onSubmit();
  };

  const intentInvalid = (section: number, index: number) =>
    submitted && issues.some((issue) => issue.code === "intent" && issue.section === section && issue.index === index);

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{t("outline.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("outline.hint")}</p>
      </div>
      {source === "mock" && <MockDataNotice compact />}

      <div className="grid gap-2">
        <Label htmlFor={`${ids}-title`}>{t("outline.deckTitle")}</Label>
        <Input
          id={`${ids}-title`}
          value={outline.title}
          maxLength={DECK_LIMITS.titleMax}
          onChange={(event) => onChange(setOutlineTitle(outline, event.target.value))}
          aria-invalid={submitted && issues.some((issue) => issue.code === "title")}
          className="rounded-xl text-base font-semibold"
        />
      </div>

      <div className="grid max-h-[46vh] gap-4 overflow-y-auto pr-1" data-testid="ai-deck-outline-sections">
        {outline.sections.map((section, s) => (
          <section key={s} aria-label={section.title || t("outline.sectionTitle", { number: s + 1 })} className="grid gap-2 rounded-xl border border-border bg-secondary/40 p-3">
            <Input
              aria-label={t("outline.sectionTitle", { number: s + 1 })}
              value={section.title}
              maxLength={DECK_LIMITS.sectionTitleMax}
              onChange={(event) => onChange(setSectionTitle(outline, s, event.target.value))}
              aria-invalid={submitted && issues.some((issue) => issue.code === "section" && issue.section === s)}
              className="h-8 border-transparent bg-transparent px-1 text-sm font-semibold text-foreground focus-visible:bg-background"
            />
            <ol className="grid gap-2">
              {section.slides.map((slide, i) => {
                const number = slideNumber(outline, s, i);
                return (
                  <li key={`${s}-${i}`} className="grid gap-2 sm:grid-cols-[auto_13rem_1fr_auto] sm:items-center">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-accent-ink" aria-hidden>
                      {number}
                    </span>
                    <select
                      aria-label={t("outline.slideType", { number })}
                      value={slide.type}
                      onChange={(event) => onChange(updateSlide(outline, s, i, { type: event.target.value }))}
                      className={selectClass}
                    >
                      {kindOptions(kinds, slide.type).map((kind) => (
                        <option key={kind} value={kind}>
                          {kindLabel(kind)}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={t("outline.slideIntent", { number })}
                      value={slide.intent}
                      maxLength={DECK_LIMITS.intentMax}
                      onChange={(event) => onChange(updateSlide(outline, s, i, { intent: event.target.value }))}
                      aria-invalid={intentInvalid(s, i)}
                      className="rounded-xl"
                    />
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        className={iconButtonClass}
                        aria-label={t("outline.moveUp", { number })}
                        disabled={s === 0 && i === 0}
                        onClick={() => onChange(moveSlide(outline, s, i, -1))}
                      >
                        <ArrowUp className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass}
                        aria-label={t("outline.moveDown", { number })}
                        disabled={s === outline.sections.length - 1 && i === section.slides.length - 1}
                        onClick={() => onChange(moveSlide(outline, s, i, 1))}
                      >
                        <ArrowDown className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass}
                        aria-label={t("outline.remove", { number })}
                        onClick={() => onChange(removeSlide(outline, s, i))}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              className="flex w-fit items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-accent-ink hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
              disabled={total >= DECK_LIMITS.maxSlides}
              onClick={() => onChange(addSlide(outline, s, newKind))}
            >
              <Plus className="size-3.5" aria-hidden />
              {t("outline.addSlide", { number: s + 1 })}
            </button>
          </section>
        ))}
      </div>

      {warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground" aria-label={t("warnings.title", { count: warnings.length })}>
          {warnings.map((warning, i) => (
            <li key={i}>{warning.message}</li>
          ))}
        </ul>
      )}

      {submitted && issues.length > 0 && (
        <ul role="alert" className="grid gap-0.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          {issues.map((issue, i) => (
            <li key={i}>{issueText(issue)}</li>
          ))}
        </ul>
      )}
      {error && <AiDeckError error={error} />}

      <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-semibold text-muted-foreground" data-testid="ai-deck-outline-count">
          {t("outline.count", { count: total })}
        </span>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="rounded-xl" onClick={onBack}>
            {t("outline.back")}
          </Button>
          <Button type="submit">
            <Sparkles className="mr-1.5 size-4" aria-hidden />
            {t("outline.submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
