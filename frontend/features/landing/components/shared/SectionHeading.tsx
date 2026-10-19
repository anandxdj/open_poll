import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  id?: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  className?: string;
}

/**
 * The one heading block every landing section uses: an h2 and an optional
 * sentence. h2 is 30/36/48px with tight tracking, the sentence 16/18px.
 */
export function SectionHeading({ id, title, description, align = "center", className }: SectionHeadingProps) {
  return (
    <div className={cn("max-w-2xl space-y-4", align === "center" ? "mx-auto text-center" : "text-left", className)}>
      <h2 id={id} className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description ? (
        <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">{description}</p>
      ) : null}
    </div>
  );
}
