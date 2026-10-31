"use client";

import Link from "next/link";
import { BarChart3, FileBarChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLive } from "@/features/presentations/live/store";
import { cn } from "@/lib/utils";
import { SessionsIntlProvider } from "../SessionsIntlProvider";
import { sessionsPath, summaryPath } from "../query";

interface EndScreenLinkProps {
  role: "host" | "participant";
  presentationId: string;
}

/**
 * `endScreen` slot entry. Participants get a link to their own results
 * (`/live/<code>/summary`); the host gets one to the session reports. The live
 * routes only load the `live` messages, so the link brings its own.
 */
export function EndScreenLink(props: EndScreenLinkProps) {
  return (
    <SessionsIntlProvider>
      <EndScreenLinkInner {...props} />
    </SessionsIntlProvider>
  );
}

function EndScreenLinkInner({ role, presentationId }: EndScreenLinkProps) {
  const t = useTranslations("sessions.endScreen");
  const joinCode = useLive((s) => s.joinCode);
  // The participant's own state carries the session it belongs to.
  const sessionId = useLive((s) => (s.me as { sessionId?: string } | null)?.sessionId ?? null);

  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg border px-5 py-3 text-sm font-medium transition-colors";

  if (role === "host") {
    return (
      <Link
        href={sessionsPath(presentationId)}
        className={cn(base, "border-deck-stage-fg/15 bg-deck-stage-fg/5 text-deck-stage-fg hover:bg-deck-stage-fg/10")}
      >
        <FileBarChart className="size-4" /> {t("hostLink")}
      </Link>
    );
  }
  if (!joinCode) return null;
  return (
    <Link
      href={summaryPath(joinCode, sessionId)}
      className={cn(base, "border-deck-border bg-deck-secondary/60 text-deck-fg hover:bg-deck-secondary")}
    >
      <BarChart3 className="size-4" /> {t("participantLink")}
    </Link>
  );
}
