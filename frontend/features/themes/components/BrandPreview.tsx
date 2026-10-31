"use client";

import { DeckThemeProvider } from "@/features/presentations/theme/DeckThemeProvider";
import { deckThemeFrom } from "../deckTheme";
import type { ThemeTokens } from "../types";

const BARS = [
  { label: "Keynote", share: 0.62 },
  { label: "Workshop", share: 0.41 },
  { label: "Panel", share: 0.18 },
];

/**
 * A theme on a small stage and a phone, drawn with the same deck tokens the
 * live surfaces use (so what you see is what the room sees).
 */
export function BrandPreview({ tokens }: { tokens: ThemeTokens }) {
  const theme = deckThemeFrom({ ...tokens, custom: true });
  const overlay = tokens.background
    ? `color-mix(in srgb, var(--deck-stage-bg) ${Math.round(tokens.background.overlayOpacity * 100)}%, transparent)`
    : "";
  return (
    <DeckThemeProvider theme={theme}>
      <figure className="space-y-3">
        <figcaption className="text-sm font-medium text-foreground">Preview</figcaption>
        <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-deck-stage-bg text-deck-stage-fg">
          {tokens.background ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `linear-gradient(${overlay}, ${overlay}), url(${JSON.stringify(tokens.background.imageUrl)})` }}
            />
          ) : null}
          <div className="relative flex h-full flex-col gap-2 p-4">
            {tokens.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the kit's own logo, any host
              <img src={tokens.logo.url} alt="" className="h-5 max-w-[96px] self-start object-contain" />
            ) : null}
            <h3 className="text-[15px] font-semibold leading-tight">Which talk did you like most?</h3>
            <div className="flex-1 space-y-1.5 rounded-md bg-deck-stage-panel p-2">
              {BARS.map((bar, i) => (
                <div key={bar.label} className="space-y-0.5">
                  <div className="flex justify-between text-[10px] text-deck-stage-fg/80">
                    <span>{bar.label}</span>
                    <span>{Math.round(bar.share * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-deck-stage-fg/10">
                    <div
                      className={i === 0 ? "h-full rounded-full bg-deck-accent" : "h-full rounded-full"}
                      style={{ width: `${bar.share * 100}%`, backgroundColor: i === 0 ? undefined : `var(--deck-cloud-${i + 1})` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-deck-correct">
                <span className="size-1.5 rounded-full bg-deck-correct" aria-hidden="true" /> 42 answers
              </span>
              <span className="rounded-full bg-deck-accent px-2.5 py-1 font-semibold text-deck-stage-ink">Next</span>
            </div>
          </div>
        </div>
        <div className="mx-auto w-44 space-y-2 rounded-2xl border border-deck-border bg-deck-bg p-3 text-deck-fg shadow-sm">
          <div className="flex items-center gap-1.5 border-b border-deck-border pb-2">
            {tokens.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the kit's own logo, any host
              <img src={tokens.logo.url} alt="" className="h-4 max-w-[48px] object-contain" />
            ) : null}
            <span className="truncate text-[10px] font-semibold">Team offsite</span>
          </div>
          <p className="text-[11px] font-semibold">Which talk did you like most?</p>
          {BARS.map((bar, i) => (
            <div
              key={bar.label}
              className={
                i === 0
                  ? "rounded-md border-2 border-deck-primary px-2 py-1 text-[10px]"
                  : "rounded-md border border-deck-border px-2 py-1 text-[10px]"
              }
            >
              {bar.label}
            </div>
          ))}
          <div className="rounded-md bg-deck-primary py-1.5 text-center text-[10px] font-semibold text-deck-primary-fg">Submit</div>
        </div>
      </figure>
    </DeckThemeProvider>
  );
}
