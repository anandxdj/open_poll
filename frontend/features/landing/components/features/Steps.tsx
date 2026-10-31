import { cn } from "@/lib/utils";
import { LiveAiMockup } from "../mockups/LiveAiMockup";
import { LivePollAnimation } from "../mockups/LivePollAnimation";
import { SharePollMockup } from "../mockups/SharePollMockup";
import { PlotPanel } from "../shared/PlotPanel";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

const steps = [
  {
    title: "Build or bring a deck",
    body: "Start blank, import a PowerPoint, PDF, Google Slides link or question sheet, or describe a topic and review the outline AI drafts, speaker notes included.",
    visual: <LiveAiMockup />,
  },
  {
    title: "Go live with a join code",
    body: "Show the code or QR code on screen. People join from their phones with just a nickname, no account needed, and answer as you present.",
    visual: <SharePollMockup />,
  },
  {
    title: "Watch the answers come in",
    body: "Results fill the screen as people answer. The audience can ask and upvote questions and send reactions while you talk.",
    visual: <LivePollAnimation />,
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
        <SectionHeading id="how-title" title="Live in three steps" />

        {/* A real sequence: numbered rows, words and picture trading sides on lg. */}
        <ol className="mt-12 space-y-16 md:mt-16 lg:space-y-24">
          {steps.map((step, i) => (
            <li key={step.title} className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-16">
              <div className={cn("max-w-xl lg:col-span-5", i % 2 === 1 && "lg:order-2")}>
                <span className="flex size-11 items-center justify-center rounded-full bg-foreground font-mono text-sm font-medium tabular-nums text-background">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-4xl">
                  {step.title}
                </h3>
                <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">{step.body}</p>
              </div>
              <PlotPanel className={cn("min-w-0 lg:col-span-7", i % 2 === 1 && "lg:order-1")}>{step.visual}</PlotPanel>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
