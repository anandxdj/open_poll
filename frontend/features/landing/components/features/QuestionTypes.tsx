import {
  CircleCheckBig,
  Cloud,
  Coins,
  Grid2x2,
  Hash,
  ListOrdered,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  SlidersHorizontal,
  TextCursorInput,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

interface QuestionType {
  label: string;
  description: string;
  icon: LucideIcon;
}

/** The slide types a deck can hold (features/presentations/slides/types); descriptions follow their meta. */
const TYPES: QuestionType[] = [
  { label: "Multiple choice", description: "Scored or not. The fastest correct answer earns the most.", icon: CircleCheckBig },
  { label: "Type answer", description: "Free text matched against the answers you accept.", icon: TextCursorInput },
  { label: "Word cloud", description: "Words grow with every repeat.", icon: Cloud },
  { label: "Open ended", description: "Free-form responses on a card wall.", icon: MessageSquareText },
  { label: "Scales", description: "Rate statements on a slider and see live averages.", icon: SlidersHorizontal },
  { label: "Ranking", description: "Order items; the combined ranking shows at the reveal.", icon: ListOrdered },
  { label: "Guess the number", description: "Everyone picks a number; score the closest guesses.", icon: Hash },
  { label: "100 points", description: "Share 100 points between your items and see where they go.", icon: Coins },
  { label: "2 by 2 grid", description: "Place items on two axes, like effort and impact.", icon: Grid2x2 },
  { label: "Pin on image", description: "Drop a pin on your image; optionally score the right area.", icon: MapPin },
  { label: "Q&A", description: "The audience asks and upvotes; you pick what goes on screen.", icon: MessagesSquare },
  { label: "Leaderboard", description: "Quiz standings between questions, no answers collected.", icon: Trophy },
];

export function QuestionTypes() {
  return (
    <section
      id="question-types"
      aria-labelledby="question-types-title"
      className={`${sectionY} scroll-mt-20 border-t border-border`}
    >
      <div className={container}>
        <SectionHeading
          id="question-types-title"
          title="From a quick poll to a full quiz"
          description="Mix interactive questions, scored rounds and plain content slides in a single deck."
        />

        {/* One bordered block; the grid gap shows the divider colour. */}
        <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4 md:mt-16">
          {TYPES.map(({ label, description, icon: Icon }) => (
            <li
              key={label}
              className="flex gap-4 bg-background p-5 transition-colors duration-150 hover:bg-card sm:block sm:p-6"
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
              <div className="sm:mt-4">
                <h3 className="text-base font-semibold tracking-tight">{label}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground sm:mt-1.5">{description}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          Add headings, text, bullets, images, big numbers, quotes and video between questions to tell the story
          around them.
        </p>
      </div>
    </section>
  );
}
