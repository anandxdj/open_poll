import { cn } from "@/lib/utils";
import type { ThemeTokens } from "../types";

/**
 * A theme in miniature: the stage colour with a heading line, a panel, an
 * accent bar and the first chart colours. Decorative; the caller names it.
 */
export function ThemeSwatch({ tokens, className }: { tokens: ThemeTokens; className?: string }) {
  const { colors } = tokens;
  return (
    <div
      aria-hidden="true"
      className={cn("relative aspect-[16/10] w-full overflow-hidden rounded-md border border-black/10", className)}
      style={{ backgroundColor: colors.background }}
    >
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
