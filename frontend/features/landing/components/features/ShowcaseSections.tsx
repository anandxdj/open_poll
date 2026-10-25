import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveAiMockup } from "../mockups/LiveAiMockup";
import { LivePollAnimation } from "../mockups/LivePollAnimation";
import { SharePollMockup } from "../mockups/SharePollMockup";
import { PlotPanel } from "../shared/PlotPanel";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

const rows = [
  {
    title: "Draft a deck with AI, then make it yours",
    description:
      "Describe your topic and AI proposes an outline you can review before anything is written. Each slide comes with speaker notes, and every word stays editable.",
    points: ["Review the outline before slides are written", "Speaker notes on every slide", "Edit anything afterwards"],
    visual: <LiveAiMockup />,
  },
  {
    title: "Bring the room in with a code",
    description:
      "Show a short join code or QR code on screen. People join from their phones without creating an account, pick a nickname and answer when you do.",
    points: ["A short code or a QR code", "A nickname is all it takes to join", "A lobby before you start"],
    visual: <SharePollMockup />,
  },
  {
    title: "Watch answers arrive, keep questions flowing",
    description:
      "Results fill the screen as answers come in. Attendees can also ask questions, upvote the best ones and send emoji reactions while you present.",
    points: ["Live bars, word clouds and scales", "Audience questions, upvoted and moderated", "Emoji reactions on the stage"],
    visual: <LivePollAnimation />,
  },
];

export function ShowcaseSections() {
  return (
    <section id="showcase" aria-labelledby="showcase-title" className={`${sectionY} scroll-mt-20 border-t border-border`}>
      <div className={container}>
        <SectionHeading
          id="showcase-title"
          title="From first draft to final report"
          description="Everything happens in one place, with your audience on their own phones."
        />

        <div className="mt-16 space-y-20 md:mt-20 lg:space-y-28">
          {rows.map((row, i) => (
            <div key={row.title} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
              <div className={cn("max-w-xl lg:col-span-5", i % 2 === 1 && "lg:order-2")}>
                <h3 className="text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-4xl">
                  {row.title}
                </h3>
                <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                  {row.description}
                </p>
                <ul className="mt-7 border-t border-border">
                  {row.points.map((point) => (
                    <li key={point} className="flex items-start gap-3 border-b border-border py-3 text-base text-foreground">
                      <Check className="mt-1 size-4 shrink-0 text-accent-ink" strokeWidth={2.25} aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <PlotPanel className={cn("min-w-0 lg:col-span-7", i % 2 === 1 && "lg:order-1")}>{row.visual}</PlotPanel>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
