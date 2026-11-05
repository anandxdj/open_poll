/**
 * A screen link (W4-D) is the stage embed URL a presenter copies from the
 * Embed dialog: `<site>/embed/stage/<deckId>?token=scr_…`. Add-in panes ask
 * for one and draw that stage themselves. Pure, unit tested.
 */
export interface ScreenLink {
  presentationId: string;
  screenToken: string;
}

const DECK_ID = /^[a-f0-9]{24}$/i;
const SCREEN_TOKEN = /^scr_[A-Za-z0-9_-]{43}$/;

/**
 * The deck and token of a pasted screen link, or null. Only links to this
 * site's stage page are accepted (`origin`), so a pane never loads a page of
 * another site; a bare path works too.
 */
export function parseScreenLink(raw: string, origin: string): ScreenLink | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  const match = /^\/embed\/stage\/([^/]+)\/?$/.exec(url.pathname);
  const token = url.searchParams.get("token") ?? "";
  if (!match || !DECK_ID.test(match[1]!) || !SCREEN_TOKEN.test(token)) return null;
  return { presentationId: match[1]!, screenToken: token };
}

/** The canonical link for a parsed screen link. */
export const screenLinkUrl = (origin: string, link: ScreenLink) =>
  `${origin}/embed/stage/${link.presentationId}?token=${encodeURIComponent(link.screenToken)}`;
