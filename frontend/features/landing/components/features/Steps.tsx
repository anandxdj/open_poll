import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

const steps = [
  {
    title: "Build or bring a deck",
    body: "Start blank, import a PowerPoint, PDF, Google Slides link or question sheet, or describe a topic and review the outline AI drafts for you.",
  },
  {
    title: "Go live with a join code",
    body: "Open the lobby and show the code or QR code. People join from their phones, no account needed, and answer as you present.",
  },
  {
    title: "Review and share",
    body: "Every run is saved as a session report. Export it, share a read-only results link, or run the deck again.",
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

        <ol className="mt-12 grid grid-cols-1 gap-10 md:mt-16 lg:grid-cols-3 lg:gap-12">
          {steps.map((step, i) => (
            <li key={step.title} className="border-t border-foreground/20 pt-6">
              <span className="font-mono text-sm tabular-nums text-accent-ink">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-2 max-w-md text-base leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
