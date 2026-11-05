"use client";

import { useEffect, useState } from "react";
import { Loader2, MonitorUp } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorStatus } from "@/lib/api-error";
import { ParticipantShell } from "@/features/presentations/components/participant/ParticipantShell";
import { getScreenState } from "../api";
import { EmbedNotice } from "../components/EmbedNotice";
import { parseScreenLink, screenLinkUrl, type ScreenLink } from "../screenLink";
import { AddinStage, browserLinkStore } from "./AddinStage";
import { connectTeams, teamsStageUrl, type TeamsHost } from "./teams";

const noStore = browserLinkStore("openpoll_addin_teams_link");

/**
 * `/addins/teams/sidepanel?link=<screen link>`: the tab's page. In a meeting's
 * side panel, attendees join and answer there (the deck's participant view)
 * and the presenter can share the live stage to the meeting stage. In a chat
 * or channel tab (`content`), it shows the stage itself.
 */
export function TeamsSidePanel({ link }: { link: string | null }) {
  const [teams, setTeams] = useState<TeamsHost | null | undefined>(undefined);
  const [deck, setDeck] = useState<{ joinCode: string } | "notFound" | "disabled" | null>(null);
  // Parsed against this page's origin, so only after mounting (the server render has no window).
  const [parsed, setParsed] = useState<ScreenLink | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => !cancelled && setParsed(link ? parseScreenLink(link, window.location.origin) : null));
    connectTeams().then((host) => !cancelled && setTeams(host));
    return () => {
      cancelled = true;
    };
  }, [link]);

  const token = parsed?.screenToken ?? null;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getScreenState(token).then(
      (state) => !cancelled && setDeck({ joinCode: (state.presentation ?? state.quiz)?.joinCode ?? "" }),
      (error: unknown) => !cancelled && setDeck(getApiErrorStatus(error) === 403 ? "disabled" : "notFound")
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (parsed === undefined) return null;
  if (!parsed) return <EmbedNotice kind="notFound" />;
  if (teams?.frameContext === "content") {
    return <AddinStage store={noStore} initialLink={link} title="Open Poll stage" hint="Paste a screen link." />;
  }
  if (deck === "notFound" || deck === "disabled") return <EmbedNotice kind={deck} />;

  const canShare = Boolean(teams?.sdk.meeting && teams.frameContext === "sidePanel");
  const share = () => {
    if (!teams?.sdk.meeting) return;
    const url = teamsStageUrl(window.location.origin, screenLinkUrl(window.location.origin, parsed));
    teams.sdk.meeting.shareAppContentToStage((error) => {
      if (error) toast.error(error.message ?? "Teams didn't share the stage");
      else toast.success("The stage is on the meeting screen");
    }, url);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="text-xs text-muted-foreground">{canShare ? "Presenting? Put the live stage on the meeting screen." : "Open Poll"}</span>
        <button
          type="button"
          disabled={!canShare}
          onClick={share}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          title={canShare ? undefined : "Available in a Teams meeting's side panel"}
        >
          <MonitorUp className="size-3.5" /> Show on meeting stage
        </button>
      </div>
      {deck === null ? (
        <div className="flex flex-1 items-center justify-center" role="status" aria-label="Loading">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ParticipantShell key={deck.joinCode} code={deck.joinCode} />
      )}
    </div>
  );
}
