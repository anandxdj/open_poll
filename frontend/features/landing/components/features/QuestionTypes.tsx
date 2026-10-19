import {
  CircleCheckBig,
  Cloud,
  Grid2x2,
  Hash,
  ListOrdered,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  SlidersHorizontal,
  TextCursorInput,
  Trophy,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

interface QuestionType {
  label: string;
  icon: LucideIcon;
}

/** The slide types the builder offers (features/presentations/slides/types), grouped by what they are for. */
const GROUPS: { title: string; blurb: string; types: QuestionType[] }[] = [
  {
    title: "Gather opinions",
    blurb: "See what the room thinks, in its own words or on a scale.",
    types: [
      { label: "Word cloud", icon: Cloud },
      { label: "Open ended", icon: MessageSquareText },
      { label: "Scales", icon: SlidersHorizontal },
      { label: "Ranking", icon: ListOrdered },
      { label: "Q&A with upvotes", icon: MessagesSquare },
    ],
  },
  {
    title: "Run a quiz",
    blurb: "Score answers, race the clock and show a leaderboard.",
    types: [
      { label: "Multiple choice", icon: CircleCheckBig },
      { label: "Type answer", icon: TextCursorInput },
      { label: "Guess the number", icon: Hash },
      { label: "Leaderboard", icon: Trophy },
    ],
  },
  {
    title: "Think together",
    blurb: "Prioritise, place and point, all from the audience's phones.",
    types: [
      { label: "100 points", icon: Coins },
      { label: "2 by 2 grid", icon: Grid2x2 },
      { label: "Pin on image", icon: MapPin },
    ],
  },
];

export function QuestionTypes() {
  return (
    <section
      id="question-types"
      aria-labelledby="question-types-title"
      className={`${sectionY} scroll-mt-20 border-y border-border bg-secondary/30`}
    >
      <div className={container}>
        <SectionHeading
          id="question-types-title"
          title="From a quick poll to a full quiz"
          description="Mix interactive questions, scored rounds and plain content slides in a single deck."
        />

        <div className="mt-12 grid grid-cols-1 gap-10 md:mt-16 lg:grid-cols-3 lg:gap-12">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xl font-bold tracking-tight">{group.title}</h3>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">{group.blurb}</p>
              <ul className="mt-5 flex flex-wrap gap-2.5">
                {group.types.map(({ label, icon: Icon }) => (
                  <li
                    key={label}
                    className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground"
                  >
                    <Icon className="size-4 text-brand-ink" aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-2xl text-center text-base text-muted-foreground">
          Add headings, text, bullets, images, big numbers, quotes and video between questions to tell the story around
          them.
        </p>
      </div>
    </section>
  );
}
