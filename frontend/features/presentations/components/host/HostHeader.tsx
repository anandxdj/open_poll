"use client";

import { Check, Copy, Maximize2, Minimize2, Trophy, Users } from "lucide-react";
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
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-deck-stage-fg/15 px-2.5 py-1 text-xs font-medium text-deck-stage-fg">
            <span className="size-1.5 rounded-full bg-deck-live motion-safe:animate-pulse" aria-hidden="true" /> {t("liveHost")}
          </div>
        ) : (
          <div className="shrink-0 rounded-full border border-deck-stage-fg/15 px-2.5 py-1 text-xs font-medium text-deck-stage-fg/70">
            {t("hostConsole")}
          </div>
        )}
        <h1 className="truncate text-[15px] font-semibold leading-none tracking-[-0.01em] text-deck-stage-fg">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <SlotOutlet name="hostToolbar" props={{ presentationId }} />
        {isLive && (
          <>
            <div className="flex items-center gap-1.5 text-sm text-deck-stage-fg/70" title={t("joined", { count: participantCount })}>
              <Users className="size-4" /> <span className="font-mono tabular-nums">{participantCount}</span>
            </div>
            <button
              type="button"
              onClick={onCopyUrl}
              title={t("copyJoinLink")}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-deck-stage-fg/15 px-3 py-1 font-mono text-sm tracking-[0.12em] text-deck-stage-fg transition-colors hover:bg-deck-stage-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50"
            >
              <span>{joinCode}</span>
              {copiedUrl ? <Check className="size-3.5 text-deck-correct-soft" /> : <Copy className="size-3.5 text-deck-stage-fg/60" />}
            </button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleLeaderboard}
          title={t("toggleLeaderboard")}
          aria-pressed={showLeaderboard}
          className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${
            showLeaderboard
              ? "border-deck-stage-fg bg-deck-stage-fg text-deck-stage-bg hover:bg-deck-stage-fg/90"
              : "border-deck-stage-fg/15 text-deck-stage-fg hover:bg-deck-stage-fg/10"
          }`}
        >
          <Trophy className="size-4" />
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
