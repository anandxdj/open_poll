"use client";

import { useMemo } from "react";
import { AddinStage, browserLinkStore, type LinkStore } from "./AddinStage";
import { loadScript, OFFICE_JS } from "./loadScript";

/** The bit of Office.js the pane uses. */
interface OfficeGlobal {
  onReady(): Promise<{ host: string | null }>;
  context?: {
    document?: {
      settings?: {
        get(name: string): unknown;
        set(name: string, value: unknown): void;
        remove(name: string): void;
        saveAsync(callback?: (result: unknown) => void): void;
      };
    };
  };
}

const SETTING = "openpollScreenLink";
const BROWSER_KEY = "openpoll_addin_powerpoint_link";

/** Office's document settings once Office.js is ready inside PowerPoint, else null. */
async function officeSettings() {
  if (!(await loadScript(OFFICE_JS))) return null;
  const office = (window as unknown as { Office?: OfficeGlobal }).Office;
  if (!office) return null;
  try {
    const info = await Promise.race([office.onReady(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))]);
    if (!info?.host) return null;
  } catch {
    return null;
  }
  return office.context?.document?.settings ?? null;
}

/**
 * Inside PowerPoint the screen link is kept with the presentation file
 * (document settings), so whoever opens the deck gets the same stage; in a
 * browser preview, in localStorage.
 */
function powerPointLinkStore(): LinkStore {
  const browser = browserLinkStore(BROWSER_KEY);
  return {
    async load() {
      const settings = await officeSettings();
      const stored = settings?.get(SETTING);
      return typeof stored === "string" ? stored : browser.load();
    },
    async save(url) {
      const settings = await officeSettings();
      if (!settings) return browser.save(url);
      if (url) settings.set(SETTING, url);
      else settings.remove(SETTING);
      settings.saveAsync();
    },
  };
}

/** `/addins/powerpoint`: the PowerPoint task pane. Shows a deck's stage next to the slides. */
export function PowerPointPane() {
  const store = useMemo(() => powerPointLinkStore(), []);
  return (
    <AddinStage
      store={store}
      title="Open Poll stage"
      hint="Paste a screen link to show the deck's live stage here: lobby, questions, live results and standings."
    />
  );
}
