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
    <section
      id="features"
      aria-labelledby="features-title"
      className={`${sectionY} scroll-mt-20 border-t border-border bg-card`}
    >
      <div className={container}>
        <SectionHeading
          id="features-title"
          title="Everything a live session needs"
          description="From the first slide to the follow-up report, in one workspace your whole team can share."
        />

        {/* One bordered block; the grid gap shows the divider colour. */}
        <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4 md:mt-16">
          {CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex gap-4 bg-background p-5 sm:block sm:p-7">
              <Icon className="mt-0.5 size-5 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
              <div className="sm:mt-5">
                <h3 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground sm:mt-2">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
