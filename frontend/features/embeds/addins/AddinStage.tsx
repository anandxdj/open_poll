"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { ScreenStage } from "../components/ScreenStage";
import { parseScreenLink, screenLinkUrl, type ScreenLink } from "../screenLink";
import { ScreenLinkForm } from "./ScreenLinkForm";

/** Where a pane keeps its screen link: the browser by default, the document in PowerPoint. */
export interface LinkStore {
  load(): Promise<string | null>;
  save(url: string | null): Promise<void>;
}

/** localStorage under `key`; every access may throw (private mode, blocked storage), so none is trusted. */
export function browserLinkStore(key: string): LinkStore {
  return {
    async load() {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async save(url) {
      try {
        if (url) window.localStorage.setItem(key, url);
        else window.localStorage.removeItem(key);
      } catch {
        // The link still works for this visit.
      }
    },
  };
}

/**
 * An add-in pane's stage (W4-D): asks for a screen link once, keeps it in
 * `store`, then draws that deck's stage (read-only, `ScreenStage`) with a
 * small bar to change the link. `initialLink` (from the pane's URL) wins over
 * a stored one.
 */
export function AddinStage({
  store,
  title,
  hint,
  initialLink = null,
}: {
  store: LinkStore;
  title: string;
  hint: string;
  initialLink?: string | null;
}) {
  const [state, setState] = useState<{ loaded: boolean; link: ScreenLink | null }>({ loaded: false, link: null });

  useEffect(() => {
    let cancelled = false;
    const fromUrl = initialLink ? parseScreenLink(initialLink, window.location.origin) : null;
    if (fromUrl) {
      Promise.resolve().then(() => !cancelled && setState({ loaded: true, link: fromUrl }));
    } else {
      store.load().then(
        (stored) => !cancelled && setState({ loaded: true, link: stored ? parseScreenLink(stored, window.location.origin) : null }),
        () => !cancelled && setState({ loaded: true, link: null })
      );
    }
    return () => {
      cancelled = true;
    };
  }, [store, initialLink]);

  if (!state.loaded) return null;

  if (!state.link) {
    return (
      <ScreenLinkForm
        title={title}
        hint={hint}
        onLink={(link) => {
          setState({ loaded: true, link });
          void store.save(screenLinkUrl(window.location.origin, link));
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-deck-stage-bg">
      <ScreenStage key={`${state.link.presentationId}:${state.link.screenToken}`} presentationId={state.link.presentationId} screenToken={state.link.screenToken} />
      <div className="flex shrink-0 items-center justify-end border-t border-deck-stage-fg/10 bg-deck-stage-chrome px-3 py-1.5">
        <button
          type="button"
          onClick={() => {
            setState({ loaded: true, link: null });
            void store.save(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-deck-stage-fg/70 hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg"
        >
          <Link2 className="size-3.5" /> Change screen link
        </button>
      </div>
    </div>
  );
}
