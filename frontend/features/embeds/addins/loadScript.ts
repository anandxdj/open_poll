/**
 * Loads a host SDK (Office.js, the Teams JS library) once per page. Resolves
 * false when it cannot load (no network, opened outside the host): panes work
 * without it, just without the host's extras.
 *
 * Office.js replaces `history.pushState`/`replaceState` with null in some
 * hosts, which breaks the Next router; they are put back after it loads.
 */
const loading = new Map<string, Promise<boolean>>();

export function loadScript(src: string): Promise<boolean> {
  const existing = loading.get(src);
  if (existing) return existing;
  const promise = new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") return resolve(false);
    const { pushState, replaceState } = window.history;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (typeof window.history.pushState !== "function") window.history.pushState = pushState;
      if (typeof window.history.replaceState !== "function") window.history.replaceState = replaceState;
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

/** Office.js, from Microsoft's CDN (add-ins must load it from there). */
export const OFFICE_JS = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";

/** The Microsoft Teams JavaScript client library (v2), from Microsoft's CDN. */
export const TEAMS_JS = "https://res.cdn.office.net/teams-js/2.22.0/js/MicrosoftTeams.min.js";
