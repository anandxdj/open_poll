"use client";

import { Check, Copy, Maximize2, Minimize2, Radio, RotateCcw, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLive } from "../../live/store";
import { SlotOutlet } from "../../live/slots";

interface HostHeaderProps {
  presentationId: string;
  busy: boolean;
  copiedUrl: boolean;
  onCopyUrl: () => void;
  showLeaderboard: boolean;
  onToggleLeaderboard: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenLobby: () => void;
}

/** Host console top bar: deck title, audience size, join code, toolbar. */
export function HostHeader({
  presentationId,
  busy,
  copiedUrl,
  onCopyUrl,
  showLeaderboard,
  onToggleLeaderboard,
  isFullscreen,
  onToggleFullscreen,
  onOpenLobby,
}: HostHeaderProps) {
  const title = useLive((s) => s.title);
  const joinCode = useLive((s) => s.joinCode);
  const status = useLive((s) => s.status);
  const participantCount = useLive((s) => s.participants.length);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-deck-stage-fg/10 px-5 bg-deck-stage-chrome">
      <div className="flex items-center gap-3 min-w-0">
        <div className="rounded-full bg-deck-danger/10 border border-deck-danger/20 px-2.5 py-1 text-deck-danger-soft text-[10px] font-bold tracking-wider uppercase flex items-center gap-1.5 shrink-0">
          <Radio className="size-3 animate-pulse" /> LIVE HOST
        </div>
        <h1 className="text-sm font-bold leading-none text-deck-stage-fg/90 truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <SlotOutlet name="hostToolbar" props={{ presentationId }} />
        <div className="flex items-center gap-1.5 text-xs font-semibold text-deck-stage-fg/60">
          <Users className="size-3.5" /> {participantCount}
        </div>
        <button
          type="button"
          onClick={onCopyUrl}
          title="Click to copy join link"
          className="font-mono text-xs font-bold tracking-widest text-deck-primary bg-deck-primary/10 border border-deck-primary/25 px-3.5 py-1 rounded-full hover:bg-deck-primary/20 transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-deck-primary/40"
        >
          <span>{joinCode}</span>
          {copiedUrl ? <Check className="size-3 text-deck-correct-soft" /> : <Copy className="size-3 text-deck-primary/70" />}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleLeaderboard}
          title="Toggle Leaderboard"
          className={`h-8 rounded-full border px-3 text-xs font-bold transition-all flex items-center gap-1.5 ${
            showLeaderboard
              ? "bg-deck-accent text-deck-stage-ink border-deck-accent shadow-md shadow-deck-accent/20"
              : "border-deck-accent/30 bg-deck-accent/10 text-deck-accent-soft hover:bg-deck-accent/20"
          }`}
        >
          <Trophy className="size-3.5" />
          <span className="hidden sm:inline">Leaderboard</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleFullscreen}
          title="Toggle Fullscreen (F)"
          className="size-8 text-deck-stage-fg/60 hover:text-deck-stage-fg hover:bg-deck-stage-fg/10"
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
        {status === "ended" && (
          <Button
            onClick={onOpenLobby}
            disabled={busy}
            className="h-8 rounded-full bg-deck-primary text-deck-primary-fg font-bold px-4 text-xs hover:opacity-90 transition-opacity"
          >
            <RotateCcw className="size-3 mr-1.5" /> Host Again
          </Button>
        )}
      </div>
    </header>
  );
}
