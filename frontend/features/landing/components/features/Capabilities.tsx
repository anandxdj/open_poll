"use client";

import {
  ChartColumn,
  FileUp,
  Link2,
  MessagesSquare,
  Presentation,
  ShieldCheck,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";
import { AiArt, DeckArt, ImportArt, LinkArt, PrivacyArt, QnaArt, ReportArt, TeamArt } from "./CapabilityArt";

interface Capability {
  icon: LucideIcon;
  title: string;
  description: string;
  art: React.ComponentType;
  /** Featured cells span 5 or 7 of the 12 lg columns; compact cells take 3. */
  span?: string;
}

/** Every line describes something the app does today (see the feature wiki pages). */
const CAPABILITIES: Capability[] = [
  {
    icon: MessagesSquare,
    title: "Q&A and reactions",
    description:
      "Attendees ask questions, upvote the best ones and react with emoji. Moderators decide what reaches the big screen.",
    art: QnaArt,
    span: "lg:col-span-7",
  },
  {
    icon: Sparkles,
    title: "AI deck generation",
    description:
      "Describe a topic, review the outline, and get a draft deck with speaker notes. Monthly AI limits depend on your plan.",
    art: AiArt,
    span: "lg:col-span-5",
  },
  {
    icon: FileUp,
    title: "Import what you have",
    description:
      "Bring in PowerPoint and PDF files, Google Slides links, or question lists from CSV and Excel, and check the result before you present.",
    art: ImportArt,
    span: "lg:col-span-5",
  },
  {
    icon: ChartColumn,
    title: "Reports and exports",
    description:
      "Each session keeps a report with results per slide and a participants table. Export CSV on every plan, Excel and PDF on paid plans.",
    art: ReportArt,
    span: "lg:col-span-7",
  },
  {
    icon: Presentation,
    title: "Live decks and quizzes",
    description:
      "Run polls, scored quizzes and leaderboards in one deck. Present from the host console while the audience follows on their phones.",
    art: DeckArt,
  },
  {
    icon: UsersRound,
    title: "Teams and roles",
    description:
      "Invite teammates to a shared workspace as owner, admin, editor, presenter or viewer, share decks and keep an audit log.",
    art: TeamArt,
  },
  {
    icon: ShieldCheck,
    title: "Private by default",
    description:
      "The audience joins without an account. Speaker notes and answer keys never reach participant devices.",
    art: PrivacyArt,
  },
  {
    icon: Link2,
    title: "Quick polls by link",
    description:
      "Need just one question? Publish a poll, share its link and follow the results on the analytics page.",
    art: LinkArt,
  },
];

export function Capabilities() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className={`${sectionY} scroll-mt-20 border-t border-border`}
    >
      <div className={container}>
        <SectionHeading
          id="features-title"
          title="Everything a live session needs"
          description="From the first slide to the follow-up report, in one workspace your whole team can share."
        />

        {/* A bento: four large cells in uneven pairs, then four compact ones, every cell with a
            small illustration. One bordered block; the grid gap shows the divider colour. */}
        <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 md:mt-16 lg:grid-cols-12">
          {CAPABILITIES.map(({ icon: Icon, title, description, art: Art, span }) => {
            const featured = Boolean(span);
            return (
              <li
                key={title}
                className={cn(
                  "flex flex-col bg-card",
                  // Featured cells span the row between sm and lg: picture beside words there,
                  // so the drawing doesn't stretch thin across the whole width.
                  featured
                    ? "gap-6 p-5 sm:col-span-2 sm:grid sm:grid-cols-2 sm:items-center sm:gap-8 sm:p-7 lg:flex lg:items-stretch"
                    : "gap-5 p-5 sm:p-6 lg:col-span-3",
                  span,
                )}
              >
                <Art />
                <div className={cn("flex", featured ? "gap-4" : "gap-3")}>
                  <Icon
                    className={cn("shrink-0 text-accent-ink", featured ? "mt-1 size-5" : "mt-0.5 size-[18px]")}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className={cn("font-semibold", featured ? "text-xl tracking-[-0.025em]" : "text-lg tracking-[-0.02em]")}>
                      {title}
                    </h3>
                    <p
                      className={cn(
                        "mt-1.5 leading-relaxed text-muted-foreground",
                        featured ? "max-w-md text-base sm:mt-2" : "text-sm",
                      )}
                    >
                      {description}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
