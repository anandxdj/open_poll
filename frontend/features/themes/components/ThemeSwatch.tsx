import { cn } from "@/lib/utils";
import type { ThemeMode, ThemeTokens } from "../types";

/** The stage in miniature: heading line, muted line, a panel with the accent bar and the first chart colours. */
function SwatchFace({ tokens, className }: { tokens: ThemeTokens; className?: string }) {
  const { colors } = tokens;
  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)} style={{ backgroundColor: colors.background }}>
      {tokens.background ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(color-mix(in srgb, ${colors.background} ${Math.round(tokens.background.overlayOpacity * 100)}%, transparent), color-mix(in srgb, ${colors.background} ${Math.round(tokens.background.overlayOpacity * 100)}%, transparent)), url(${JSON.stringify(tokens.background.imageUrl)})`,
          }}
        />
      ) : null}
      <div className="relative flex h-full flex-col justify-between p-[8%]">
        <div className="space-y-[6%]">
          <div className="h-[9%] min-h-1 w-3/5 rounded-full" style={{ backgroundColor: colors.text }} />
          <div className="h-[6%] min-h-0.5 w-2/5 rounded-full opacity-70" style={{ backgroundColor: colors.mutedText }} />
        </div>
        <div className="flex items-end gap-[5%] rounded-sm p-[5%]" style={{ backgroundColor: colors.surface }}>
          <div className="h-5 w-[18%] rounded-[2px]" style={{ backgroundColor: colors.accent }} />
          {colors.chart.slice(1, 4).map((color, i) => (
            <div key={i} className="w-[18%] rounded-[2px]" style={{ backgroundColor: color, height: `${10 + i * 3}px` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A theme in miniature (one palette: a brand kit, or a preset in one mode). Decorative; the caller names it. */
export function ThemeSwatch({ tokens, className }: { tokens: ThemeTokens; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative aspect-[16/10] w-full overflow-hidden rounded-md border border-black/10", className)}
    >
      <SwatchFace tokens={tokens} />
    </div>
  );
}

/**
 * A preset light and dark side by side, the deck's current mode marked by a
 * thin underline in its accent. Decorative; the caller names it.
 */
export function ThemeModesSwatch({
  modes,
  mode,
  className,
}: {
  modes: Record<ThemeMode, ThemeTokens>;
  mode: ThemeMode;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative grid aspect-[16/10] w-full grid-cols-2 overflow-hidden rounded-md border border-black/10", className)}
    >
      {(["light", "dark"] as const).map((key) => (
        <div key={key} className="relative" data-swatch-mode={key}>
          <SwatchFace tokens={modes[key]} />
          {key === mode ? (
            <span className="absolute inset-x-[12%] bottom-[4%] h-0.5 rounded-full" style={{ backgroundColor: modes[key].colors.accent }} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
