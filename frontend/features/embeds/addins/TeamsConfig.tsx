"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CopyField } from "../components/CopyField";
import { screenLinkUrl, type ScreenLink } from "../screenLink";
import { ScreenLinkForm } from "./ScreenLinkForm";
import { connectTeams, teamsSidePanelUrl, type TeamsHost } from "./teams";

/**
 * `/addins/teams/config`: the configuration page Teams opens when someone
 * adds the Open Poll tab to a meeting, chat or channel. It takes a screen
 * link and saves a tab whose page is the side panel view of that deck
 * (`/addins/teams/sidepanel?link=…`). Outside Teams it shows the tab address
 * it would save.
 */
export function TeamsConfig() {
  const [teams, setTeams] = useState<TeamsHost | null | undefined>(undefined);
  const [chosen, setChosen] = useState<{ link: ScreenLink; contentUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    connectTeams().then((host) => !cancelled && setTeams(host));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!teams || !chosen) return;
    const config = teams.sdk.pages.config;
    config.registerOnSaveHandler((event) => {
      config
        .setConfig({
          entityId: `openpoll-${chosen.link.presentationId}`,
          contentUrl: chosen.contentUrl,
          websiteUrl: screenLinkUrl(window.location.origin, chosen.link),
          suggestedDisplayName: "Open Poll",
        })
        .then(
          () => event.notifySuccess(),
          (error: unknown) => event.notifyFailure(String(error))
        );
    });
    config.setValidityState(true);
  }, [teams, chosen]);

  return (
    <div className="min-h-dvh bg-background">
      <ScreenLinkForm
        title="Add Open Poll to Teams"
        hint="Paste the deck's screen link. Attendees answer in the side panel; you share the live stage to the meeting."
        submitLabel="Use this screen link"
        onLink={(link) => {
          const url = screenLinkUrl(window.location.origin, link);
          setChosen({ link, contentUrl: teamsSidePanelUrl(window.location.origin, url) });
        }}
      />
      {chosen ? (
        <div className="mx-auto w-full max-w-md space-y-3 px-5 pb-8" role="status">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-4 text-success" />
            {teams ? "Ready. Select Save in Teams to add the tab." : "Open this page from Teams to save the tab."}
          </p>
          <CopyField label="Tab address" value={chosen.contentUrl} />
        </div>
      ) : teams === null ? (
        <p className="mx-auto max-w-md px-5 pb-8 text-xs text-muted-foreground">Not running inside Teams: you can try the link here, but saving needs Teams.</p>
      ) : null}
    </div>
  );
}
