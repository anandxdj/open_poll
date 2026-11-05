"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLive } from "@/features/presentations/live/store";

const pad = (n: number) => String(n).padStart(2, "0");

/** `h:mm:ss` (or `mm:ss` under an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Ticks once a second on the client; null during the server render. */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Session clock: time since the session opened (on the server's clock, so a
 * reload or a second window agrees) and the presenter's local time.
 */
export function SessionClock() {
  const t = useTranslations("presenter.console");
  const startedAt = useLive((s) => s.sessionStartedAt);
  const status = useLive((s) => s.status);
  const offset = useLive((s) => s.clockOffsetMs ?? 0);
  const now = useNow();
  const live = status === "lobby" || status === "active";
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const elapsed = live && now !== null && !Number.isNaN(startedMs) ? formatElapsed(now + offset - startedMs) : null;
  const local =
    now === null ? "--:--" : new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <section aria-label={t("clock")} className="flex items-center justify-between gap-3">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-deck-stage-fg/50">
          <Clock className="size-3.5" aria-hidden="true" /> {t("elapsed")}
        </p>
        <p className="font-mono text-2xl font-semibold tabular-nums text-deck-stage-fg" data-testid="session-elapsed">
          {elapsed ?? t("notStarted")}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium uppercase tracking-wider text-deck-stage-fg/50">{t("localTime")}</p>
        <p className="font-mono text-lg tabular-nums text-deck-stage-fg/80">{local}</p>
      </div>
    </section>
  );
}
