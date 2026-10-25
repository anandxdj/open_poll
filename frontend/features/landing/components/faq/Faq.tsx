"use client";

import { useState } from "react";
import { Accordion } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";
import { FAQS } from "../../content";

export function Faq() {
  const [open, setOpen] = useState("");
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

        <Accordion.Root type="single" collapsible value={open} onValueChange={setOpen} className="divide-y divide-border border-y border-foreground/15">
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
              {/* Answers stay in the HTML while closed (`hidden`), so search engines and AI
                  crawlers that do not run scripts still read them. */}
              <Accordion.Content
                forceMount
                hidden={open !== item.q}
                className="overflow-hidden data-[state=open]:animate-accordion-down"
              >
                <p className="max-w-2xl pb-6 text-base leading-relaxed text-muted-foreground">{item.a}</p>
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </div>
    </section>
  );
}
