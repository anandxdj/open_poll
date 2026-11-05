import { ChartColumn, FileUp, Link2, UsersRound, type LucideIcon } from "lucide-react";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

interface Capability {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * What the rest of the page doesn't already show. Every line describes something
 * the app does today (see the feature wiki pages).
 */
const CAPABILITIES: Capability[] = [
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
      className={`${sectionY} scroll-mt-20 border-t border-border`}
    >
      <div className={container}>
        <SectionHeading id="features-title" title="Everything around the session" />

        {/* One bordered block; the grid gap shows the divider colour. */}
        <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 md:mt-16 lg:grid-cols-4">
          {CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <li key={title} className="bg-card p-6 sm:p-7">
              <Icon className="size-5 text-accent-ink" strokeWidth={1.75} aria-hidden="true" />
              <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
