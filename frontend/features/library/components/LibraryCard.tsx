"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowRightLeft,
  BarChart3,
  Copy,
  ExternalLink,
  FileBarChart,
  Layers,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Presentation,
  Share2,
  Target,
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
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { closePoll, convertPollToPresentation, deleteLibraryItem } from "../api/library";
import { cardLinks, deckBuilderPath, kindLabel, statusLabel } from "../query";
import type { LibraryCard as LibraryCardData, PollLibraryCard, PresentationLibraryCard } from "../types";

const statusTone: Record<LibraryCardData["status"], string> = {
  draft: "border-border bg-secondary/40 text-muted-foreground",
  live: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  ended: "border-border bg-secondary/30 text-muted-foreground/80",
};

const actionClass =
  "flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors active:scale-[0.98]";
const primaryAction = cn(actionClass, "bg-primary text-primary-foreground hover:opacity-90");
const secondaryAction = cn(
  actionClass,
  "border border-border bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground",
);
const menuItemClass = "flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium";

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

  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-[2rem] border border-border bg-card p-5 transition-all duration-300",
        "hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
        busy && "pointer-events-none opacity-70",
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
              statusTone[card.status],
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                card.status === "live" ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-muted-foreground/60",
              )}
            />
            {statusLabel(card)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">
            {isPoll ? (
              card.details.pollType === "TRIAL" ? (
                <Target className="size-3" />
              ) : (
                <BarChart3 className="size-3" />
              )
            ) : (
              <Presentation className="size-3" />
            )}
            {kindLabel(card)}
          </span>
          {!isPoll && card.details.legacySource ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              From {card.details.legacySource}
            </span>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${card.title}`}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1">
            {card.entityType === "poll" ? (
              <PollMenuItems
                poll={card}
                onCopyLink={() => void copyText(links().share, `${card.details.pollType === "TRIAL" ? "Assessment" : "Poll"} link copied!`)}
                onConvert={(force) => void handleConvert(card, force)}
                onClose={() => setConfirm("close")}
              />
            ) : (
              <>
                <DropdownMenuItem asChild className={menuItemClass}>
                  <Link href={sessionsPath(card.id)}>
                    <FileBarChart className="size-4" /> Session history
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={menuItemClass}
                  onSelect={() => void copyText(links().share, "Join link copied!")}
                >
                  <Copy className="size-4" /> Copy join link
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={cn(menuItemClass, "text-red-500 focus:bg-red-500/10 focus:text-red-500")}
              onSelect={() => setConfirm("delete")}
            >
              <Trash2 className="size-4" /> Delete {noun}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mb-5 min-h-[3.25rem]">
        <h3 className="mb-1.5 line-clamp-2 text-base font-bold tracking-tight text-foreground/90">
          {card.title || (isPoll ? "Untitled poll" : "Untitled deck")}
        </h3>
        {card.entityType === "poll" ? <PollMeta poll={card} /> : <DeckMeta deck={card} />}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2.5">
        {card.entityType === "poll" ? (
          card.status === "draft" ? (
            <Link href={cardLinks(card, "").open} className={cn(primaryAction, "col-span-2")}>
              <Pencil className="size-3.5" /> Edit draft
            </Link>
          ) : (
            <>
              <Link href={cardLinks(card, "").open} className={secondaryAction}>
                <BarChart3 className="size-3.5" /> Analytics
              </Link>
              <button
                type="button"
                onClick={() => void copyText(links().share, `${card.details.pollType === "TRIAL" ? "Assessment" : "Poll"} link copied!`)}
                className={primaryAction}
              >
                <Share2 className="size-3.5" /> Share
              </button>
            </>
          )
        ) : (
          <>
            <Link href={cardLinks(card, "").open} className={secondaryAction}>
              <Pencil className="size-3.5" /> Edit
            </Link>
            <Link href={cardLinks(card, "").run} className={primaryAction}>
              <Play className="size-3.5" /> {card.details.phase === "lobby" || card.details.phase === "active" ? "Resume" : "Present"}
            </Link>
          </>
        )}
      </div>

      <p className="mt-4 border-t border-border/50 pt-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
        Updated {formatDistanceToNowStrict(new Date(card.updatedAt), { addSuffix: true })}
      </p>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <AlertDialogContent className="rounded-3xl border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">
              {confirm === "close" ? "Close poll?" : `Delete ${noun}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
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
          <AlertDialogFooter className="mt-4 gap-3">
            <AlertDialogCancel className="rounded-xl border-border bg-secondary/50 hover:bg-secondary">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (confirm === "close" && card.entityType === "poll") void handleClose(card);
                else void handleDelete();
              }}
              className="rounded-xl bg-red-500 font-bold text-white transition-colors hover:bg-red-600"
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
          <DropdownMenuItem asChild className={menuItemClass}>
            <Link href={cardLinks(poll, "").run} target="_blank" rel="noopener">
              <ExternalLink className="size-4" /> Open voting page
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className={menuItemClass} onSelect={onCopyLink}>
            <Copy className="size-4" /> Copy link
          </DropdownMenuItem>
        </>
      ) : null}
      {converted ? (
        <>
          <DropdownMenuItem asChild className={menuItemClass}>
            <Link href={deckBuilderPath(converted)}>
              <Presentation className="size-4" /> Open converted deck
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className={menuItemClass} onSelect={() => onConvert(true)}>
            <ArrowRightLeft className="size-4" /> Convert again
          </DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuItem className={menuItemClass} onSelect={() => onConvert(false)}>
          <ArrowRightLeft className="size-4" /> Convert to presentation
        </DropdownMenuItem>
      )}
      {poll.status === "live" ? (
        <DropdownMenuItem className={menuItemClass} onSelect={onClose}>
          <XCircle className="size-4" /> Close poll
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function PollMeta({ poll }: { poll: PollLibraryCard }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-muted-foreground/60">
      <span className="flex items-center gap-1" title="Questions">
        <MessageSquare className="size-3" />
        {poll.stats.questionCount}
      </span>
      <span className="flex items-center gap-1" title="Responses">
        <Users className="size-3" />
        {poll.stats.responseCount}
      </span>
      {!poll.details.isAnonymous ? (
        <span className="flex items-center gap-1" title="Respondents identify themselves">
          <Lock className="size-3" /> Verified
        </span>
      ) : null}
      {poll.status === "live" && poll.details.expiresAt ? (
        <span className="text-primary/80">
          Closes {formatDistanceToNowStrict(new Date(poll.details.expiresAt), { addSuffix: true })}
        </span>
      ) : null}
    </div>
  );
}

function DeckMeta({ deck }: { deck: PresentationLibraryCard }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-muted-foreground/60">
      <span className="flex items-center gap-1.5">
        <Layers className="size-3" /> {deck.stats.slideCount} slide{deck.stats.slideCount === 1 ? "" : "s"}
      </span>
      {deck.details.slideTypes.length > 0 ? (
        <span className="flex items-center gap-1">
          {deck.details.slideTypes.map((type) => {
            const meta = slideTypeMeta(type as PresentationSlideType);
            return <meta.Icon key={type} className={cn("size-3.5", meta.iconClass)} aria-label={meta.label} />;
          })}
        </span>
      ) : null}
      {deck.details.joinCode ? (
        <span className="ml-auto font-mono font-bold tracking-widest" title="Join code">
          {deck.details.joinCode}
        </span>
      ) : null}
    </div>
  );
}
