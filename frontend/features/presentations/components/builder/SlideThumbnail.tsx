import { cn } from "@/lib/utils";
import { slideTypeMeta } from "../../slides/meta";
import type { PresentationSlide } from "../../types/deck";

// Static 16:9 preview of a slide for the builder rail. This is the only
// thumbnail renderer the builder imports: once the runtime registry lands,
// swap this body for `<StageView slide={slide} mode="thumbnail" />` and
// every caller follows.

const MAX_ENTRIES = 4;

function previewEntries(slide: PresentationSlide): string[] {
  switch (slide.type) {
    case "select_answer":
      return slide.options.map((o) => o.text);
    case "type_answer":
      return slide.acceptedAnswers;
    case "scales":
      return slide.statements;
    case "ranking":
      return slide.items;
    default:
      return [];
  }
}

export function SlideThumbnail({ slide, className }: { slide: PresentationSlide; className?: string }) {
  const meta = slideTypeMeta(slide.type);
  const entries = previewEntries(slide).slice(0, MAX_ENTRIES);
  const question = slide.question.trim();

  return (
    <div
      aria-hidden
      className={cn(
        "relative flex aspect-video w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-secondary/20 p-2",
        className
      )}
    >
      <meta.Icon className={cn("size-3 shrink-0", meta.iconClass)} />
      <p
        className={cn(
          "mt-1 line-clamp-2 text-[9px] font-semibold leading-tight",
          question ? "text-foreground/85" : "text-muted-foreground/50"
        )}
      >
        {question || meta.label}
      </p>
      {entries.length > 0 && (
        <div className="mt-auto space-y-0.5">
          {entries.map((entry, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full bg-white/10"
              style={{ width: `${Math.max(30, 100 - i * 15)}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
