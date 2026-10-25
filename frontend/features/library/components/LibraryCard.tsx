"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowRightLeft,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  FileBarChart,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Presentation,
  Share2,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { slideTypeMeta } from "@/features/presentations/slides/meta";
import { sessionsPath } from "@/features/sessions/query";
import type { PresentationSlideType } from "@/features/presentations/types/deck";
import { ShareDialog } from "@/features/workspaces/sharing/components/ShareDialog";
import { useCanShareDecks } from "@/features/workspaces/sharing/useCanShare";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { closePoll, convertPollToPresentation, deleteLibraryItem } from "../api/library";
import { cardLinks, deckBuilderPath, kindLabel, statusLabel } from "../query";
import type { LibraryCard as LibraryCardData, PollLibraryCard, PresentationLibraryCard } from "../types";

/** Status pill dot: live pulses green, drafts are faint, ended is quiet. */
const statusDot: Record<LibraryCardData["status"], string> = {
  draft: "bg-faint",
  live: "bg-success motion-safe:animate-pulse",
  ended: "bg-muted-foreground/50",
};

/** Card actions sit above the stretched title link. */
const action = "relative z-10";

interface LibraryCardProps {
  card: LibraryCardData;
  onRemoved: (card: LibraryCardData) => void;
  onChanged: (card: LibraryCardData) => void;
}

type Confirm = "delete" | "close" | null;

async function copyText(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(success);
  } catch {
    toast.error("Couldn't copy to the clipboard.");
  }
}

export function LibraryCard({ card, onRemoved, onChanged }: LibraryCardProps) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const canShareDecks = useCanShareDecks();
  const isPoll = card.entityType === "poll";
  const noun = isPoll ? (card.details.pollType === "TRIAL" ? "assessment" : "poll") : "deck";

  const links = () => cardLinks(card, window.location.origin);

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteLibraryItem(card);
      onRemoved(card);
      toast.success(isPoll ? "Poll deleted." : "Deck deleted.");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? `Couldn't delete the ${noun}.`);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function handleClose(poll: PollLibraryCard) {
    setBusy(true);
    try {
      await closePoll(poll.id);
      onChanged({ ...poll, status: "ended" });
      toast.success("Poll closed.");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't close the poll.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function handleConvert(poll: PollLibraryCard, force: boolean) {
    setBusy(true);
    try {
      const { created, presentation } = await convertPollToPresentation(poll.id, { force });
      onChanged({ ...poll, details: { ...poll.details, convertedPresentationId: presentation._id } });
      toast.success(created ? "Converted. Opening the new deck…" : "Opening the deck converted earlier…");
      router.push(deckBuilderPath(presentation._id));
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't convert this poll.");
      setBusy(false);
    }
  }

  const openHref = cardLinks(card, "").open;
  const shareLabel = `${card.entityType === "poll" && card.details.pollType === "TRIAL" ? "Assessment" : "Poll"} link copied!`;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] duration-200",
        "hover:border-foreground/20 hover:shadow-[0_16px_32px_-24px_rgb(23_23_23/0.4)]",
        busy && "pointer-events-none opacity-70",
      )}
    >
      <CardPreview card={card} />

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-base font-semibold leading-snug tracking-[-0.015em] text-foreground">
            {/* The title opens the item; its ::after stretches the link over the whole card. */}
            <Link
              href={openHref}
              className="line-clamp-2 rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {card.title || (isPoll ? "Untitled poll" : "Untitled deck")}
            </Link>
          </h3>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More actions for ${card.title}`}
                className={cn(
                  action,
                  "-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                )}
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1.5">
              {card.entityType === "poll" ? (
                <PollMenuItems
                  poll={card}
                  onCopyLink={() => void copyText(links().share, shareLabel)}
                  onConvert={(force) => void handleConvert(card, force)}
                  onClose={() => setConfirm("close")}
                />
              ) : (
                <>
                  <DropdownMenuItem asChild>
                    <Link href={sessionsPath(card.id)}>
                      <FileBarChart /> Session history
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyText(links().share, "Join link copied!")}>
                    <Copy /> Copy join link
                  </DropdownMenuItem>
                  {canShareDecks ? (
                    <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                      <Users /> Share with team…
                    </DropdownMenuItem>
                  ) : null}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                <Trash2 /> Delete {noun}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {card.entityType === "poll" ? <PollMeta poll={card} /> : <DeckMeta deck={card} />}
        <p className="sr-only">
          {statusLabel(card)}. Updated {formatDistanceToNowStrict(new Date(card.updatedAt), { addSuffix: true })}.
        </p>

        <div className="mt-auto flex items-center justify-end gap-3 pt-5">
          <div className="flex shrink-0 gap-2">
            {card.entityType === "poll" ? (
              card.status === "draft" ? (
                <Button asChild size="sm" variant="ink" className={action}>
                  <Link href={openHref}>
                    <Pencil /> Edit draft
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="sm" variant="outline" className={action}>
                    <Link href={openHref}>
                      <BarChart3 /> Analytics
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ink"
                    className={action}
                    onClick={() => void copyText(links().share, shareLabel)}
                  >
                    <Share2 /> Share
                  </Button>
                </>
              )
            ) : (
              <>
                <Button asChild size="sm" variant="outline" className={action}>
                  <Link href={openHref}>
                    <Pencil /> Edit
                  </Link>
                </Button>
                {/* A running session is the one thing on the page that needs you: it gets the accent. */}
                {card.details.phase === "lobby" || card.details.phase === "active" ? (
                  <Button asChild size="sm" className={action}>
                    <Link href={cardLinks(card, "").run}>
                      <Play /> Resume
                    </Link>
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="ink" className={action}>
                    <Link href={cardLinks(card, "").run}>
                      <Play /> Present
                    </Link>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {!isPoll && shareOpen ? (
        <ShareDialog open onOpenChange={setShareOpen} resourceType="presentation" resourceId={card.id} title={card.title} />
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "close" ? "Close poll?" : `Delete ${noun}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "close" ? (
                <>
                  <strong>&quot;{card.title}&quot;</strong> stops accepting responses.
                </>
              ) : isPoll ? (
                <>
                  This cannot be undone. All responses and analytics for <strong>&quot;{card.title}&quot;</strong> will be
                  deleted. A deck converted from it is kept.
                </>
              ) : (
                <>
                  This cannot be undone. All slides, session history and results of{" "}
                  <strong>&quot;{card.title}&quot;</strong> will be deleted.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (confirm === "close" && card.entityType === "poll") void handleClose(card);
                else void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirm === "close" ? "Close poll" : `Delete ${noun}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function PollMenuItems({
  poll,
  onCopyLink,
  onConvert,
  onClose,
}: {
  poll: PollLibraryCard;
  onCopyLink: () => void;
  onConvert: (force: boolean) => void;
  onClose: () => void;
}) {
  const converted = poll.details.convertedPresentationId;
  return (
    <>
      {poll.status !== "draft" ? (
        <>
          <DropdownMenuItem asChild>
            <Link href={cardLinks(poll, "").run} target="_blank" rel="noopener">
              <ExternalLink /> Open voting page
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopyLink}>
            <Copy /> Copy link
          </DropdownMenuItem>
        </>
      ) : null}
      {converted ? (
        <>
          <DropdownMenuItem asChild>
            <Link href={deckBuilderPath(converted)}>
              <Presentation /> Open converted deck
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onConvert(true)}>
            <ArrowRightLeft /> Convert again
          </DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuItem onSelect={() => onConvert(false)}>
          <ArrowRightLeft /> Convert to presentation
        </DropdownMenuItem>
      )}
      {poll.status === "live" ? (
        <DropdownMenuItem onSelect={onClose}>
          <XCircle /> Close poll
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

const meta = "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground";
const count = "font-mono text-xs tabular-nums text-foreground";

function PollMeta({ poll }: { poll: PollLibraryCard }) {
  const { questionCount, responseCount } = poll.stats;
  return (
    <div className={meta}>
      <span>{kindLabel(poll)}</span>
      <span>
        <span className={count}>{questionCount}</span> question{questionCount === 1 ? "" : "s"}
      </span>
      <span>
        <span className={count}>{responseCount}</span> response{responseCount === 1 ? "" : "s"}
      </span>
      {!poll.details.isAnonymous ? (
        <span className="flex items-center gap-1" title="Respondents identify themselves">
          <Lock className="size-3.5" aria-hidden="true" /> Verified
        </span>
      ) : null}
      {poll.status === "live" && poll.details.expiresAt ? (
        <span className="text-accent-ink">
          Closes {formatDistanceToNowStrict(new Date(poll.details.expiresAt), { addSuffix: true })}
        </span>
      ) : null}
    </div>
  );
}

function DeckMeta({ deck }: { deck: PresentationLibraryCard }) {
  const { slideCount } = deck.stats;
  return (
    <div className={meta}>
      <span>{kindLabel(deck)}</span>
      {deck.details.legacySource ? <span>From {deck.details.legacySource}</span> : null}
      <span>
        <span className={count}>{slideCount}</span> slide{slideCount === 1 ? "" : "s"}
      </span>
      {deck.details.joinCode ? (
        <span className="ml-auto font-mono text-xs tracking-[0.14em] text-foreground" title="Join code">
          {deck.details.joinCode}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The top of a card, on graph paper: a deck is a dark mini screen with one tile
 * per slide type it holds; a poll is a small ballot sheet (a check on one row
 * for assessments). Pictures of the item's kind and shape, never of results.
 */
function CardPreview({ card }: { card: LibraryCardData }) {
  return (
    <div aria-hidden="true" className="relative h-32 overflow-hidden border-b border-border bg-background">
      <div className="mk-grid mk-grid-flat absolute inset-0" />
      <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground">
        <span className={cn("size-1.5 rounded-full", statusDot[card.status])} />
        {statusLabel(card)}
      </span>
      <span className="absolute right-3 top-3.5 z-10 rounded bg-background/80 px-1 text-xs text-muted-foreground">
        Updated {formatDistanceToNowStrict(new Date(card.updatedAt), { addSuffix: true })}
      </span>
      <div className="relative flex h-full items-center justify-center px-6 pt-6">
        {card.entityType === "presentation" ? <DeckThumb deck={card} /> : <PollThumb poll={card} />}
      </div>
    </div>
  );
}

function DeckThumb({ deck }: { deck: PresentationLibraryCard }) {
  const types = deck.details.slideTypes.slice(0, 5);
  const more = deck.details.slideTypes.length - types.length;
  return (
    <div className="dark w-full max-w-[13rem] rounded-lg border border-border bg-background p-2.5 shadow-[0_12px_24px_-16px_rgb(23_23_23/0.6)]">
      <span className="block h-1.5 w-1/2 rounded-full bg-foreground/70" />
      <div className="mt-2.5 flex items-center gap-1.5">
        {types.length === 0 ? (
          <Presentation className="size-5 text-muted-foreground" />
        ) : (
          types.map((type) => {
            const { Icon } = slideTypeMeta(type as PresentationSlideType);
            return (
              <span key={type} className="flex size-8 items-center justify-center rounded-md border border-border bg-card text-accent-ink">
                <Icon className="size-4" />
              </span>
            );
          })
        )}
        {more > 0 ? <span className="font-mono text-xs text-muted-foreground">+{more}</span> : null}
      </div>
    </div>
  );
}

function PollThumb({ poll }: { poll: PollLibraryCard }) {
  const assessment = poll.details.pollType === "TRIAL";
  return (
    <div className="w-full max-w-[13rem] space-y-1.5 rounded-lg border border-border bg-card p-2.5 shadow-[0_12px_24px_-16px_rgb(23_23_23/0.35)]">
      <span className="block h-1.5 w-3/5 rounded-full bg-foreground/70" />
      {[0, 1, 2].map((row) => (
        <span key={row} className="flex items-center gap-1.5">
          {assessment && row === 1 ? (
            <span className="flex size-3 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-2" strokeWidth={4} />
            </span>
          ) : (
            <span className="size-3 rounded-full border border-input" />
          )}
          <span className={cn("h-1 rounded-full bg-muted-foreground/30", row === 0 ? "w-3/4" : row === 1 ? "w-1/2" : "w-2/3")} />
        </span>
      ))}
    </div>
  );
}
