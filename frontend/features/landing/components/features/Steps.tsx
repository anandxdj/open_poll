import { cn } from "@/lib/utils";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";
import { BuildArt, JoinArt, ShareArt } from "./StepArt";

const steps = [
  {
    title: "Build or bring a deck",
    body: "Start blank, import a PowerPoint, PDF, Google Slides link or question sheet, or describe a topic and review the outline AI drafts for you.",
    art: BuildArt,
  },
  {
    title: "Go live with a join code",
    body: "Open the lobby and show the code or QR code. People join from their phones, no account needed, and answer as you present.",
    art: JoinArt,
  },
  {
    title: "Review and share",
    body: "Every run is saved as a session report. Export it, share a read-only results link, or run the deck again.",
    art: ShareArt,
  },
];

export function Steps() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className={`${sectionY} scroll-mt-20 border-t border-border bg-card`}
    >
      <div className={container}>
        <SectionHeading
          id="how-title"
          title="Live in three steps"
          description="From a blank page to a room full of answers, usually in one sitting."
        />

        {/* A real sequence: numbered stations on one rule that runs across the row on lg. */}
        <ol className="mt-12 grid grid-cols-1 gap-12 md:mt-16 lg:grid-cols-3 lg:gap-0">
          {steps.map((step, i) => (
            <li key={step.title} className="lg:pr-10">
              <div className="flex items-center">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground font-mono text-sm font-medium tabular-nums text-background">
                  {i + 1}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "ml-4 h-px flex-1 bg-foreground/15 lg:ml-0",
                    // Reaches the next station across the column gap; the last one stops at the edge.
                    i < steps.length - 1 && "lg:-mr-10",
                  )}
                />
              </div>
              <div className="mt-6">
                <step.art />
              </div>
              <h3 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">{step.title}</h3>
              <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
