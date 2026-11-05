import { loadScript, TEAMS_JS } from "./loadScript";

/** The bit of the Teams JavaScript library (v2) the panes use. */
export interface TeamsSdk {
  app: {
    initialize(): Promise<void>;
    getContext(): Promise<{ page?: { frameContext?: string } }>;
  };
  pages: {
    config: {
      registerOnSaveHandler(handler: (event: { notifySuccess(): void; notifyFailure(reason?: string): void }) => void): void;
      setConfig(config: { entityId: string; contentUrl: string; websiteUrl?: string; suggestedDisplayName?: string }): Promise<void>;
      setValidityState(valid: boolean): void;
    };
  };
  meeting?: {
    shareAppContentToStage(callback: (error: { message?: string } | null, result: boolean | null) => void, url: string): void;
  };
}

export interface TeamsHost {
  sdk: TeamsSdk;
  /** `content` (a tab), `sidePanel`, `meetingStage`, `settings` (the config page), … */
  frameContext: string | null;
}

let pending: Promise<TeamsHost | null> | null = null;

/**
 * The Teams SDK once it is initialised inside Teams, else null (opened in a
 * plain browser, or the library could not load). Outside Teams `initialize`
 * never answers, so it is given 3 seconds.
 */
export function connectTeams(): Promise<TeamsHost | null> {
  pending ??= (async () => {
    if (!(await loadScript(TEAMS_JS))) return null;
    const sdk = (window as unknown as { microsoftTeams?: TeamsSdk }).microsoftTeams;
    if (!sdk) return null;
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3000));
    try {
      if ((await Promise.race([sdk.app.initialize().then(() => "ok" as const), timeout])) !== "ok") return null;
      const context = await Promise.race([sdk.app.getContext(), timeout]);
      return { sdk, frameContext: context === "timeout" ? null : (context.page?.frameContext ?? null) };
    } catch {
      return null;
    }
  })();
  return pending;
}

/** The tab's page for a screen link: the side panel (and channel tab) view of the deck. */
export const teamsSidePanelUrl = (origin: string, screenLinkUrl: string) =>
  `${origin}/addins/teams/sidepanel?link=${encodeURIComponent(screenLinkUrl)}`;

/** What the side panel shares to the meeting stage. */
export const teamsStageUrl = (origin: string, screenLinkUrl: string) =>
  `${origin}/addins/teams/stage?link=${encodeURIComponent(screenLinkUrl)}`;
