"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, FilePlus2, ListChecks, Presentation, RefreshCw, Sparkles, Upload, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth";
import {
  HeadlineNumbers,
  InsightsError,
  RangeSwitch,
  RecentSessions,
  TopContent,
} from "@/features/analytics/components/InsightsOverview";
import { useInsights } from "@/features/analytics/hooks/useInsights";
import { formatPercent, timeAgo, type Insights, type RangeDays } from "@/features/analytics/insights";
import { ImportLauncher } from "@/features/imports";
import { LibraryCard } from "@/features/library/components/LibraryCard";
import { LibraryCardSkeleton } from "@/features/library/components/LibraryView";
import { cardKey, cardLinks } from "@/features/library/query";
import type { PresentationLibraryCard } from "@/features/library/types";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";
import { useCreatePresentationModal } from "@/features/presentations/components/CreatePresentationModalProvider";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";
import { firstName, greetingFor, spacedJoinCode, todayLabel } from "../greeting";
import { RECENT_LIMIT, useHomeLibrary } from "../hooks/useHomeLibrary";

/**
 * Home (/home): where a creator lands. What is live right now, ways to start,
 * the workspace's numbers for a range, then recent work and recent sessions.
 * Everything here links on to the library, a builder, the host console or a report.
 */
export function HomeView() {
  const mounted = useMounted();
  const user = useAuthStore((s) => s.user);
  const [days, setDays] = useState<RangeDays>(30);
  const insights = useInsights(days);
  const library = useHomeLibrary();
  const { open: openCreatePresentationModal } = useCreatePresentationModal();

  // Time of day and the name are only known in the browser; the server renders the neutral line.
  const name = mounted ? firstName(user?.name) : null;
  const hello = mounted ? greetingFor(new Date().getHours()) : "Welcome back";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="meta-label min-h-[1lh]">{mounted ? todayLabel(new Date()) : null}</p>
          <h1 className="mt-3 text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">
            {hello}
            {name ? (
              <>
                , <span className="font-serif font-normal italic tracking-[-0.01em] text-accent-ink">{name}</span>
              </>
            ) : null}
          </h1>
        </div>
        <Button onClick={() => openCreatePresentationModal()} className="self-start sm:self-auto">
          <Presentation /> New deck
        </Button>
      </header>

      <div className="mt-10 space-y-14">
        {library.live.length > 0 ? <LiveBanner decks={library.live} insights={insights.data} /> : null}

        <StartTiles />

        <section aria-labelledby="home-numbers" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="home-numbers" className="text-xl font-semibold tracking-[-0.02em]">
              Last {days} days
            </h2>
            <div className="flex items-center gap-3">
              <Link href="/analytics" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Open analytics
              </Link>
              <RangeSwitch value={days} onChange={setDays} />
            </div>
          </div>
          {insights.status === "error" && !insights.data ? (
            <InsightsError onRetry={insights.retry} />
          ) : (
            <div aria-busy={insights.status === "loading"} className={cn("transition-opacity duration-200", insights.status === "loading" && insights.data && "opacity-60")}>
              <HeadlineNumbers data={insights.data} />
            </div>
          )}
        </section>

        <section aria-labelledby="home-recent" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="home-recent" className="text-xl font-semibold tracking-[-0.02em]">
                Recent work
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">The decks and polls edited last in this workspace.</p>
            </div>
            {library.counts && library.counts.all > library.recent.length ? (
              <Link href="/polls" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                All {library.counts.all.toLocaleString()} in the library
              </Link>
            ) : null}
          </div>
          <RecentWork library={library} />
        </section>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-8">
          <RecentSessions data={insights.data} />
          <TopContent data={insights.data} />
        </div>
      </div>
    </div>
  );
}

// ---------- Live now ----------

async function copyText(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(success);
  } catch {
    toast.error("Couldn't copy to the clipboard.");
  }
}

/** The deck that is live right now, on the dark stage colours, with its join code and the way back to the host console. */
function LiveBanner({ decks, insights }: { decks: PresentationLibraryCard[]; insights: Insights | null }) {
  const [deck, ...others] = decks;
  const session = insights?.recentSessions.find((s) => s.presentationId === deck.id && s.isLive) ?? null;
  const inLobby = deck.details.phase === "lobby";
  const links = () => cardLinks(deck, window.location.origin);

  return (
    <section
      aria-labelledby="home-live"
      className="dark relative overflow-hidden rounded-2xl border border-border bg-background text-foreground"
    >
      <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col gap-6 p-6 sm:p-7 lg:flex-row lg:items-center lg:gap-10">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-accent-ink">
              <span aria-hidden className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
              {inLobby ? "Lobby open" : "Live now"}
            </span>
            {session ? <span className="meta-label">Started {timeAgo(session.startedAt)}</span> : null}
          </p>
          <h2 id="home-live" className="mt-3 truncate text-2xl font-semibold tracking-[-0.03em]">
            {deck.title}
          </h2>
          {others.length > 0 ? (
            <Link href="/polls?type=presentation&status=live" className="mt-1 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              {others.length} more live
            </Link>
          ) : null}
        </div>

        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <dt className="meta-label">Join code</dt>
            <dd className="mt-1.5 font-mono text-3xl font-medium tabular-nums tracking-[-0.02em]">{spacedJoinCode(deck.details.joinCode)}</dd>
          </div>
          {session ? (
            <>
              <div>
                <dt className="meta-label">Joined</dt>
                <dd className="mt-1.5 font-mono text-3xl font-medium tabular-nums tracking-[-0.02em]">{session.participantCount.toLocaleString()}</dd>
              </div>
              {session.participationRate !== null ? (
                <div>
                  <dt className="meta-label">Answered</dt>
                  <dd className="mt-1.5 font-mono text-3xl font-medium tabular-nums tracking-[-0.02em] text-accent-ink">
                    {formatPercent(session.participationRate)}
                  </dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href={`/presentation/host/${deck.id}`}>Open host console</Link>
          </Button>
          <Button variant="outline" size="lg" onClick={() => void copyText(links().share, "Join link copied.")}>
            <Copy /> Copy join link
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------- Ways to start ----------

function Tile({
  Icon,
  title,
  body,
  accent = false,
  onClick,
}: {
  Icon: LucideIcon;
  title: string;
  body: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-36 flex-col items-start gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors duration-150 hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 items-center justify-center rounded-md",
          accent ? "bg-primary/12 text-accent-ink" : "bg-secondary text-foreground",
        )}
      >
        <Icon className="size-[18px]" strokeWidth={1.8} />
      </span>
      <span>
        <span className="block text-[15px] font-semibold tracking-[-0.015em] text-foreground">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}

function StartTiles() {
  const { open: openCreatePollModal } = useCreatePollModal();
  const { open: openCreatePresentationModal } = useCreatePresentationModal();
  return (
    <section aria-labelledby="home-start" className="space-y-5">
      <h2 id="home-start" className="text-xl font-semibold tracking-[-0.02em]">
        Start something
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile Icon={FilePlus2} title="Blank deck" body="Slides, questions and quizzes in one deck." onClick={() => openCreatePresentationModal()} />
        <Tile Icon={ListChecks} title="Quick poll" body="One link, answers in minutes. No presenting." onClick={() => openCreatePollModal()} />
        <Tile
          Icon={Sparkles}
          title="Generate with AI"
          body="Give it a topic. Review the outline, then the slides."
          accent
          onClick={() => openCreatePresentationModal()}
        />
        <ImportLauncher>
          {(open) => <Tile Icon={Upload} title="Import" body="PowerPoint, PDF, Google Slides or a list of questions." onClick={open} />}
        </ImportLauncher>
      </div>
    </section>
  );
}

// ---------- Recent work ----------

function RecentWork({ library }: { library: ReturnType<typeof useHomeLibrary> }) {
  if (library.status === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <LibraryCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (library.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
        <p className="text-sm text-foreground">Couldn&apos;t load your recent work.</p>
        <Button variant="outline" size="sm" className="bg-card" onClick={library.retry}>
          <RefreshCw /> Try again
        </Button>
      </div>
    );
  }
  if (library.recent.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-dashed border-input bg-card px-6 py-12 text-center">
        <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
        <div className="relative">
          <p className="text-lg font-semibold tracking-[-0.02em]">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Start with a blank deck, a quick poll or a topic for the AI. What you make shows up here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {library.recent.slice(0, RECENT_LIMIT).map((card) => (
        <LibraryCard key={cardKey(card)} card={card} onRemoved={library.remove} onChanged={library.replace} />
      ))}
    </div>
  );
}
