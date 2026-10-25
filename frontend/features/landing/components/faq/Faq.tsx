"use client";

import { Accordion } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

const FAQS = [
  {
    q: "Does my audience need an account?",
    a: "No. People join a live session with its code or QR code, choose a nickname and answer from their phone. Only the people who build and present decks need an account.",
  },
  {
    q: "What kinds of questions can I ask?",
    a: "Multiple choice (scored or not), typed answers, word clouds, open-ended responses, scales, rankings, number guesses, 100-point splits, 2 by 2 grids and pins on an image, plus Q&A with upvotes and emoji reactions.",
  },
  {
    q: "Can I use my existing slides or questions?",
    a: "Yes. Import a PowerPoint or PDF file, a Google Slides link, or a CSV or Excel list of questions. Some content, such as charts or videos, may need a quick check afterwards, and the import result lists what to review.",
  },
  {
    q: "How does the AI deck generator work?",
    a: "Describe your topic and audience. AI proposes an outline for you to review, then writes the slides with speaker notes. You can edit every slide, and monthly generation limits depend on your plan.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. Free lets you build decks and run live sessions with a smaller audience and fewer AI and import runs. The pricing section above always shows the current limits of every plan.",
  },
  {
    q: "Can my team work together?",
    a: "Yes. Invite people to a workspace and give each a role: owner, admin, editor, presenter or viewer. Decks can be shared with members, and workspace activity is recorded in an audit log.",
  },
  {
    q: "What can I do with the results?",
    a: "Every run of a deck is saved as a session with a report: results per slide, a leaderboard for quizzes and a participants table. Export it as CSV (Excel and PDF on paid plans), share a read-only results link, or delete the session when you no longer need it.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={`${sectionY} scroll-mt-20 border-t border-border`}>
      <div className={cn(container, "grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16")}>
        <SectionHeading
          id="faq-title"
          title="Questions, answered"
          description="The short version of how Open Poll works."
          layout="stack"
          className="lg:sticky lg:top-28 lg:self-start"
        />

        <Accordion.Root type="single" collapsible className="divide-y divide-border border-y border-foreground/15">
          {FAQS.map((item) => (
            <Accordion.Item key={item.q} value={item.q} className="group">
              <Accordion.Header>
                <Accordion.Trigger className="flex min-h-16 w-full items-center justify-between gap-4 rounded-md py-5 text-left text-lg font-semibold tracking-[-0.015em] text-foreground transition-colors duration-150 hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-xl">
                  {item.q}
                  <ChevronDown
                    className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[state=open]:rotate-180"
                    aria-hidden="true"
                  />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <p className="max-w-2xl pb-6 text-base leading-relaxed text-muted-foreground">{item.a}</p>
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </div>
    </section>
  );
}
