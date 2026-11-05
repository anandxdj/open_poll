"use client";

import { useMemo } from "react";
import { AddinStage, browserLinkStore } from "./AddinStage";

/**
 * `/addins/zoom`: the Zoom App's page. The Zoom client opens it in its own
 * web view (the OWASP headers Zoom checks come from next.config); the
 * presenter pastes a screen link once and shares the app's screen.
 */
export function ZoomPane() {
  const store = useMemo(() => browserLinkStore("openpoll_addin_zoom_link"), []);
  return (
    <AddinStage
      store={store}
      title="Open Poll in Zoom"
      hint="Paste a screen link to show the deck's live stage, then share this app's screen with the meeting. Attendees join from their phones with the code on screen."
    />
  );
}

/** `/addins/teams/stage?link=…`: what the side panel shares to a Teams meeting's stage. */
export function TeamsStage({ link }: { link: string | null }) {
  const store = useMemo(() => browserLinkStore("openpoll_addin_teams_link"), []);
  return <AddinStage store={store} initialLink={link} title="Open Poll stage" hint="Paste a screen link to show the deck's live stage." />;
}
