"use client";

import { Check, Copy, Maximize2, Minimize2, Radio, Trophy, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useLive } from "../../live/store";
import { SlotOutlet } from "../../live/slots";

interface HostHeaderProps {
  presentationId: string;
  copiedUrl: boolean;
  onCopyUrl: () => void;
  showLeaderboard: boolean;
  onToggleLeaderboard: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Host console top bar: deck title, audience size, join code, toolbar. */
export function HostHeader({
  presentationId,
  copiedUrl,
  onCopyUrl,
  showLeaderboard,
  onToggleLeaderboard,
  isFullscreen,
  onToggleFullscreen,
}: HostHeaderProps) {
  const t = useTranslations("presenter.header");
  const title = useLive((s) => s.title);
  const joinCode = useLive((s) => s.joinCode);
  const status = useLive((s) => s.status);
  const participantCount = useLive((s) => s.participants.length);
  // Only a live session has people and a code to join with.
  const isLive = status === "lobby" || status === "active";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-deck-stage-fg/10 px-5 bg-deck-stage-chrome">
      <div className="flex items-center gap-3 min-w-0">
        {isLive ? (
          <div className="rounded-full bg-deck-danger/10 border border-deck-danger/20 px-2.5 py-1 text-deck-danger-soft text-[10px] font-bold tracking-wider uppercase flex items-center gap-1.5 shrink-0">
            <Radio className="size-3 animate-pulse" /> {t("liveHost")}
          </div>
        ) : (
          <div className="rounded-full bg-deck-stage-fg/5 border border-deck-stage-fg/10 px-2.5 py-1 text-deck-stage-fg/60 text-[10px] font-bold tracking-wider uppercase shrink-0">
            {t("hostConsole")}
          </div>
        )}
        <h1 className="text-sm font-bold leading-none text-deck-stage-fg/90 truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <SlotOutlet name="hostToolbar" props={{ presentationId }} />
        {isLive && (
          <>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-deck-stage-fg/60" title={t("joined", { count: participantCount })}>
              <Users className="size-3.5" /> {participantCount}
            </div>
            <button
              type="button"
              onClick={onCopyUrl}
              title={t("copyJoinLink")}
              className="font-mono text-xs font-bold tracking-widest text-deck-primary bg-deck-primary/10 border border-deck-primary/25 px-3.5 py-1 rounded-full hover:bg-deck-primary/20 transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-deck-primary/40"
            >
              <span>{joinCode}</span>
              {copiedUrl ? <Check className="size-3 text-deck-correct-soft" /> : <Copy className="size-3 text-deck-primary/70" />}
            </button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleLeaderboard}
          title={t("toggleLeaderboard")}
          className={`h-8 rounded-full border px-3 text-xs font-bold transition-all flex items-center gap-1.5 ${
            showLeaderboard
              ? "bg-deck-accent text-deck-stage-ink border-deck-accent shadow-md shadow-deck-accent/20"
              : "border-deck-accent/30 bg-deck-accent/10 text-deck-accent-soft hover:bg-deck-accent/20"
          }`}
        >
          <Trophy className="size-3.5" />
          <span className="hidden sm:inline">{t("leaderboard")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleFullscreen}
          title={t("toggleFullscreen")}
          className="size-8 text-deck-stage-fg/60 hover:text-deck-stage-fg hover:bg-deck-stage-fg/10"
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>
    </header>
  );
}
