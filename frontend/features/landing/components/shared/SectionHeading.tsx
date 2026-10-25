import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  id?: string;
  title: string;
  description?: string;
  /** `split`: h2 left, sentence right on wide screens. `stack`: sentence under the h2. */
  layout?: "split" | "stack";
  className?: string;
}

/**
 * The one heading block every landing section uses: a left-aligned h2
 * (36/48/56px, tight tracking) and an optional sentence (16/18px).
 */
export function SectionHeading({ id, title, description, layout = "split", className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "grid gap-5",
        layout === "split" && "lg:grid-cols-12 lg:items-end lg:gap-10",
        className,
      )}
    >
      <h2
        id={id}
        className={cn(
          "text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-5xl lg:text-[3.5rem]",
          layout === "split" ? "lg:col-span-7" : "max-w-xl",
        )}
      >
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            "max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg",
            layout === "split" && "lg:col-span-5 lg:pb-1.5",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
