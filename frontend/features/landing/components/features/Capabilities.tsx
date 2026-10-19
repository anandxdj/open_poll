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
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

interface Capability {
  icon: LucideIcon;
  title: string;
  description: string;
}

/** Every line describes something the app does today (see the feature wiki pages). */
const CAPABILITIES: Capability[] = [
  {
    icon: Presentation,
    title: "Live decks and quizzes",
    description:
      "Run polls, scored quizzes and leaderboards in one deck. Present from the host console while the audience follows on their phones.",
  },
  {
    icon: MessagesSquare,
    title: "Q&A and reactions",
    description:
      "Attendees ask questions, upvote the best ones and react with emoji. Moderators decide what reaches the big screen.",
  },
  {
    icon: Sparkles,
    title: "AI deck generation",
    description:
      "Describe a topic, review the outline, and get a draft deck with speaker notes. Monthly AI limits depend on your plan.",
  },
  {
    icon: FileUp,
    title: "Import what you have",
    description:
      "Bring in PowerPoint and PDF files, Google Slides links, or question lists from CSV and Excel, and check the result before you present.",
  },
  {
    icon: ChartColumn,
    title: "Reports and exports",
    description:
      "Each session keeps a report with results per slide and a participants table. Export CSV on every plan, Excel and PDF on paid plans.",
  },
  {
    icon: UsersRound,
    title: "Teams and roles",
    description:
      "Invite teammates to a shared workspace as owner, admin, editor, presenter or viewer, share decks and keep an audit log.",
  },
  {
    icon: ShieldCheck,
    title: "Private by default",
    description:
      "The audience joins without an account. Speaker notes and answer keys never reach participant devices.",
  },
  {
    icon: Link2,
    title: "Quick polls by link",
    description:
      "Need just one question? Publish a poll, share its link and follow the results on the analytics page.",
  },
];

export function Capabilities() {
  return (
    <section id="features" aria-labelledby="features-title" className={`${sectionY} scroll-mt-20`}>
      <div className={container}>
        <SectionHeading
          id="features-title"
          title="Everything a live session needs"
          description="From the first slide to the follow-up report, in one workspace your whole team can share."
        />

        {/* One bezel, hairline dividers: the grid gap shows the border colour. */}
        <div className="mt-12 rounded-[2rem] border border-foreground/10 bg-foreground/5 p-1.5 md:mt-16">
          <ul className="grid gap-px overflow-hidden rounded-[calc(2rem-0.375rem)] bg-border sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map(({ icon: Icon, title, description }) => (
              <li key={title} className="group bg-card p-6 transition-colors duration-500 hover:bg-secondary/60 sm:p-7">
                <span className="flex size-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-brand-ink">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-xl font-bold tracking-tight">{title}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">{description}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
