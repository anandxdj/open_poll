"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  CircleCheckBig,
  Cloud,
  MapPin,
  MessagesSquare,
  Pause,
  Play,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";
import { container, sectionY } from "../shared/styles";
import { ease } from "../shared/motion";
import { SectionHeading } from "../shared/SectionHeading";
import { SCENES, type SceneId } from "../stage/scenes";

interface QuestionType {
  id: SceneId;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** A few of the slide types a deck can hold (features/presentations/slides/types); descriptions follow their meta. */
const TYPES: QuestionType[] = [
  { id: "multiple-choice", label: "Multiple choice", description: "Scored or not. The fastest correct answer earns the most.", icon: CircleCheckBig },
  { id: "word-cloud", label: "Word cloud", description: "Words grow with every repeat.", icon: Cloud },
  { id: "pin", label: "Pin on image", description: "Drop a pin on your image; optionally score the right area.", icon: MapPin },
  { id: "qna", label: "Q&A", description: "The audience asks and upvotes; you pick what goes on screen.", icon: MessagesSquare },
  { id: "leaderboard", label: "Leaderboard", description: "Quiz standings between questions, no answers collected.", icon: Trophy },
];

/** The slide types without a tab, named under the list so the page still says they exist. */
const MORE_TYPES = "Type answer, Open ended, Scales, Ranking, Guess the number, 100 points and 2 by 2 grid";

/** How long each type stays on the stage while the section plays by itself. */
const DWELL_MS = 6500;

/**
 * Slide types as a picker beside one live stage: the stage shows the selected
 * type's result arriving (sample data, `stage/scenes.tsx`). While the stage is
 * on screen it moves to the next type every few seconds, pausing on hover or
 * focus; picking a type or pressing pause stops that for good. Reduced motion:
 * no autoplay and every result shows settled.
 */
export function QuestionTypes() {
  const reduce = useReducedMotion();
  // Autoplay controls appear after mount: the server cannot know about reduced motion.
  const mounted = useMounted();
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inView = useInView(stageRef, { amount: 0.5 });
  const seen = useInView(stageRef, { once: true, amount: 0.35 });

  const current = TYPES[index];
  const { question, Scene } = SCENES[current.id];
  const canAutoplay = mounted && !reduce;
  const autoplay = canAutoplay && !stopped;
  const running = autoplay && inView && !hovering && !focused;

  // On phones the tabs are one scrolling row: keep the selected chip in sight without moving the page.
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current[index];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: tab.offsetLeft - list.offsetLeft - 16, behavior: reduce ? "auto" : "smooth" });
  }, [index, reduce]);

  const select = (i: number, focus = false) => {
    setStopped(true);
    setIndex(i);
    if (focus) tabRefs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = TYPES.length - 1;
    const next: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    if (e.key in next) {
      e.preventDefault();
      select(next[e.key], true);
    }
  };

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
          description="Pick a slide type to see how its results arrive on the big screen."
        />

        <div
          // On lg the stage spans both rows: the tabs sit in the first, the "seven more" line under them.
          // The 1fr row takes the stage's extra height, so the line stays right below the tabs.
          className="mt-12 grid grid-cols-1 gap-6 md:mt-16 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-6"
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
          }}
        >
          {/* Tabs: a scrolling row of chips on phones, an index of rows beside the stage on lg. */}
          <div
            ref={listRef}
            role="tablist"
            aria-label="Slide types"
            className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:col-span-4 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-t lg:border-foreground/15 lg:px-0"
          >
            {TYPES.map((type, i) => {
              const Icon = type.icon;
              const selected = i === index;
              return (
                <button
                  key={type.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`qt-tab-${type.id}`}
                  aria-selected={selected}
                  aria-controls="qt-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(i)}
                  onKeyDown={onKeyDown}
                  className={cn(
                    "group relative flex shrink-0 items-center gap-2.5 rounded-full border px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    "lg:items-start lg:gap-3.5 lg:whitespace-normal lg:rounded-none lg:border-0 lg:border-b lg:border-border lg:px-0 lg:py-3.5 lg:text-left lg:text-base",
                    selected
                      ? "border-foreground bg-foreground text-background lg:border-border lg:bg-transparent lg:text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground lg:bg-transparent",
                  )}
                >
                  {/* Ember rule marking the selected row on lg */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -left-4 top-3.5 bottom-3.5 hidden w-0.5 rounded-full bg-primary transition-opacity duration-200 lg:block",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon
                    className={cn("size-4 shrink-0 lg:mt-1", selected ? "lg:text-accent-ink" : "")}
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block">{type.label}</span>
                    {selected ? (
                      <span className="mt-1 hidden text-sm font-normal leading-relaxed text-muted-foreground lg:block">
                        {type.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            id="qt-panel"
            role="tabpanel"
            aria-labelledby={`qt-tab-${current.id}`}
            className="min-w-0 lg:sticky lg:top-24 lg:col-span-8 lg:row-span-2 lg:self-start"
          >
            {/* The stage follows the app theme: a sheet with the scene on graph paper. */}
            <div
              ref={stageRef}
              className="overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-[0_32px_64px_-28px_rgb(23_23_23/0.3)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                <div className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <current.icon className="size-4 shrink-0 text-accent-ink" aria-hidden="true" />
                  <span className="truncate">{current.label}</span>
                </div>
                {canAutoplay ? (
                  <button
                    type="button"
                    onClick={() => setStopped((s) => !s)}
                    aria-label={autoplay ? "Pause the slide type tour" : "Play the slide type tour"}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {autoplay ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                  </button>
                ) : null}
              </div>

              {/* Time left on this type; when it runs out the next one comes up. */}
              <div className="h-0.5 bg-border">
                {autoplay ? (
                  <span
                    key={index}
                    className="mk-progress block h-full origin-left bg-primary"
                    style={{ animationDuration: `${DWELL_MS}ms`, animationPlayState: running ? "running" : "paused" }}
                    onAnimationEnd={() => setIndex((i) => (i + 1) % TYPES.length)}
                  />
                ) : null}
              </div>

              <div role="img" aria-label={`Sample ${current.label} results: ${current.description}`} className="relative bg-background px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-7">
                <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={current.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22, ease }}
                    className="relative"
                  >
                    <p className="min-h-[2lh] text-balance text-2xl font-semibold leading-tight tracking-[-0.035em] sm:text-[1.75rem]">
                      {question}
                    </p>
                    <div className="mt-6 h-[300px]">{seen ? <Scene /> : null}</div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            <p className="mt-4 text-base text-muted-foreground lg:hidden">{current.description}</p>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground lg:col-span-4 lg:col-start-1 lg:row-start-2">
            Seven more types: {MORE_TYPES}.
          </p>
        </div>
      </div>
    </section>
  );
}
