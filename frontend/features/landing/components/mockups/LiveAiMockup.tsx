import {
  CircleCheckBig,
  Cloud,
  Heading1,
  MessagesSquare,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { MockFrame } from "./MockFrame";

const OUTLINE: { icon: LucideIcon; kind: string; title: string }[] = [
  { icon: Heading1, kind: "Heading", title: "Welcome and goals" },
  { icon: Cloud, kind: "Word cloud", title: "What do you hope to learn today?" },
  { icon: CircleCheckBig, kind: "Multiple choice", title: "Which channel gets the most tickets?" },
  { icon: SlidersHorizontal, kind: "Scales", title: "How confident are you with refunds?" },
  { icon: MessagesSquare, kind: "Q&A", title: "Ask us anything" },
];

/** Showcase illustration: describe a topic, review the AI outline. */
export function LiveAiMockup() {
  return (
    <MockFrame
      label="Illustration of the AI deck builder: a topic prompt above an outline of five proposed slides."
      icon={<Sparkles />}
      title="Draft with AI"
    >
      <div className="rounded-lg border border-input bg-background px-3.5 py-3">
        <p className="text-xs text-muted-foreground">Topic</p>
        <p className="mt-0.5 text-sm text-foreground">Onboarding workshop for new support agents</p>
      </div>

      <p className="mb-3 mt-6 text-sm font-medium text-foreground">Outline to review</p>
      <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {OUTLINE.map(({ icon: Icon, kind, title }, i) => (
          <li key={title} className="flex items-center gap-3 bg-background px-3.5 py-2.5">
            <span className="w-4 font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{title}</span>
            </span>
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <Icon className="size-3.5" aria-hidden="true" />
              {kind}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">Speaker notes included</span>
        <span className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground">
          Write slides
        </span>
      </div>
    </MockFrame>
  );
}
