import { env } from '../../common/config/env';
import { ApiError } from '../../common/utils/ApiError';
import { resolveDomain } from '../domains/domains.service';
import { PresentationModel, type IPresentation } from '../presentations/models/presentation.model';
import { PresentationSessionModel } from '../presentations/models/session.model';
import { isShareActive } from '../sessions/share.service';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { normalizeOrigins } from './origins';
import { isEmbedAllowed, resolveScreenToken } from './screenTokens.service';

/**
 * Embed policy and oEmbed (W4-D). Three things can be embedded, each a page of
 * the frontend under `/embed/*`:
 *
 * | Kind | Page | Identified by |
 * | --- | --- | --- |
 * | `live` | `/embed/live/<code>` (also `/live/<code>`) | the deck's join code |
 * | `results` | `/embed/results/<token>` (also `/r/<token>`) | a public results link |
 * | `stage` | `/embed/stage/<deckId>?token=<screen token>` | a screen token of that deck |
 *
 * Every kind needs the deck's `settings.embed.allowed` (off by default). The
 * deck's workspace may limit which sites may frame it (`settings.embedAllowedOrigins`);
 * an empty list means any site.
 */

export const EMBED_KINDS = ['live', 'results', 'stage'] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

export interface EmbedTarget {
  kind: EmbedKind;
  /** Join code, results token or deck id. */
  id: string;
  /** Screen token (stage only). */
  token?: string | null;
}

export interface EmbedPolicy {
  allowed: boolean;
  /** Why not, when `allowed` is false. */
  reason: 'NOT_FOUND' | 'EMBED_DISABLED' | null;
  /** `frame-ancestors` sources for the page: `['*']`, or the workspace's sites. Empty when not allowed. */
  frameAncestors: string[];
}

const JOIN_CODE = /^[A-Za-z0-9]{4,12}$/;
const RESULTS_TOKEN = /^[A-Za-z0-9_-]{22,128}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

interface ResolvedTarget {
  presentation: IPresentation;
  title: string;
}

/** The deck behind an embed target, or null when there is none (or the link no longer works). */
async function resolveTarget(target: EmbedTarget): Promise<ResolvedTarget | null> {
  if (target.kind === 'live') {
    if (!JOIN_CODE.test(target.id)) return null;
    const presentation = await PresentationModel.findOne({ joinCode: target.id.trim(), deletedAt: null });
    return presentation ? { presentation, title: presentation.title } : null;
  }
  if (target.kind === 'results') {
    if (!RESULTS_TOKEN.test(target.id)) return null;
    const session = await PresentationSessionModel.findOne({ 'share.token': target.id }).select('presentationId share isLive status runNumber');
    if (!session || !isShareActive(session.share) || session.isLive || session.status !== 'ended') return null;
    const presentation = await PresentationModel.findOne({ _id: session.presentationId, deletedAt: null });
    return presentation ? { presentation, title: `${presentation.title} — results` } : null;
  }
  if (!OBJECT_ID.test(target.id)) return null;
  const screen = await resolveScreenToken(target.token);
  if (!screen || String(screen.presentation._id) !== target.id) return null;
  return { presentation: screen.presentation, title: screen.presentation.title };
}

/** The sites a deck's workspace lets frame its embeds: `['*']` when it names none. */
async function frameAncestorsOf(presentation: IPresentation): Promise<string[]> {
  if (!presentation.workspaceId) return ['*'];
  const workspace = await WorkspaceModel.findOne({ _id: presentation.workspaceId, deletedAt: null })
    .select('settings.embedAllowedOrigins')
    .lean();
  const origins = normalizeOrigins(workspace?.settings?.embedAllowedOrigins ?? []);
  return origins.length ? origins : ['*'];
}

/** What the frontend proxy needs to serve an embed page: may it render, and who may frame it. */
export async function getEmbedPolicy(target: EmbedTarget): Promise<EmbedPolicy> {
  const resolved = await resolveTarget(target);
  if (!resolved) return { allowed: false, reason: 'NOT_FOUND', frameAncestors: [] };
  if (!isEmbedAllowed(resolved.presentation)) return { allowed: false, reason: 'EMBED_DISABLED', frameAncestors: [] };
  return { allowed: true, reason: null, frameAncestors: await frameAncestorsOf(resolved.presentation) };
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const primaryOrigin = () => new URL(env.FRONTEND_URL).origin;

/** The embed page of a target, on `origin`. */
export function embedPageUrl(origin: string, target: EmbedTarget): string {
  const url = new URL(`/embed/${target.kind}/${encodeURIComponent(target.id)}`, origin);
  if (target.kind === 'stage' && target.token) url.searchParams.set('token', target.token);
  return url.toString();
}

/**
 * The embed target a URL of this site points at, or null for anything else:
 * another site, another page, a malformed id. `/live/<code>` and `/r/<token>`
 * are accepted next to their `/embed/...` twins. The origin is checked by the
 * caller (`resolveEmbedUrl`).
 */
export function parseEmbedPath(url: URL): EmbedTarget | null {
  const segments = url.pathname.replace(/\/+$/, '').split('/').slice(1).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return '';
    }
  });
  const [first, second, third, ...rest] = segments;
  if (first === 'embed' && rest.length === 0 && third) {
    if (second === 'live' && JOIN_CODE.test(third)) return { kind: 'live', id: third };
    if (second === 'results' && RESULTS_TOKEN.test(third)) return { kind: 'results', id: third };
    if (second === 'stage' && OBJECT_ID.test(third)) {
      const token = url.searchParams.get('token');
      return token ? { kind: 'stage', id: third, token } : null;
    }
    return null;
  }
  if (first === 'live' && second && JOIN_CODE.test(second) && !third) return { kind: 'live', id: second };
  if (first === 'r' && second && RESULTS_TOKEN.test(second) && !third) return { kind: 'results', id: second };
  return null;
}

const notEmbeddable = () => ApiError.notFound('No embeddable Open Poll page at that URL');

/**
 * Parses a URL given to oEmbed. It must be an http(s) URL on this site's
 * frontend, or on an active custom domain of the deck's own workspace (checked
 * once the deck is known, in `getOEmbed`).
 */
function parseRequestedUrl(raw: string): { url: URL; target: EmbedTarget; primary: boolean } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw notEmbeddable();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw notEmbeddable();
  if (url.username || url.password) throw notEmbeddable();
  const target = parseEmbedPath(url);
  if (!target) throw notEmbeddable();
  return { url, target, primary: url.origin === primaryOrigin() };
}

// ---------------------------------------------------------------------------
// oEmbed
// ---------------------------------------------------------------------------

/** Default iframe size per kind (the page then asks its host for its real height). */
const DEFAULT_SIZE: Record<EmbedKind, { width: number; height: number }> = {
  live: { width: 420, height: 640 },
  results: { width: 800, height: 900 },
  stage: { width: 960, height: 540 },
};
const MIN_SIZE = 200;
const MAX_SIZE = 4000;

export interface OEmbedRequest {
  url: string;
  maxwidth?: number;
  maxheight?: number;
}

/** oEmbed 1.0 `rich` response. */
export interface OEmbedResponse {
  version: '1.0';
  type: 'rich';
  provider_name: string;
  provider_url: string;
  title: string;
  html: string;
  width: number;
  height: number;
  cache_age: number;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');

/** Fits the kind's default size into maxwidth × maxheight (the stage keeps 16:9). */
export function fitSize(kind: EmbedKind, maxwidth?: number, maxheight?: number): { width: number; height: number } {
  const clamp = (n: number | undefined) => (n && Number.isFinite(n) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.floor(n))) : undefined);
  const maxW = clamp(maxwidth);
  const maxH = clamp(maxheight);
  let { width, height } = DEFAULT_SIZE[kind];
  if (kind === 'stage') {
    if (maxW && width > maxW) [width, height] = [maxW, Math.round((maxW * 9) / 16)];
    if (maxH && height > maxH) [width, height] = [Math.round((maxH * 16) / 9), maxH];
    return { width, height };
  }
  if (maxW) width = Math.min(width, maxW);
  if (maxH) height = Math.min(height, maxH);
  return { width, height };
}

/** The iframe HTML for an embed page (also shown in the builder's Embed dialog). */
export function iframeHtml(src: string, title: string, size: { width: number; height: number }): string {
  return (
    `<iframe src="${escapeHtml(src)}" title="${escapeHtml(title)}" width="${size.width}" height="${size.height}" ` +
    `style="border:0;max-width:100%" allow="clipboard-write; fullscreen" loading="lazy" ` +
    `referrerpolicy="strict-origin-when-cross-origin"></iframe>`
  );
}

/**
 * `GET /api/oembed?url=…&format=json`: a `rich` response whose `html` is an
 * iframe of the embed page, for results, live and stage URLs of this site
 * only. 404 for anything else (another site, a page that is not embeddable, a
 * link that no longer works), 403 `EMBED_DISABLED` when the deck does not
 * allow embedding.
 */
export async function getOEmbed(request: OEmbedRequest): Promise<OEmbedResponse> {
  const { url, target, primary } = parseRequestedUrl(request.url);
  const resolved = await resolveTarget(target);
  if (!resolved) throw notEmbeddable();
  if (!primary) {
    // A custom domain only embeds its own workspace's decks.
    const domain = await resolveDomain(url.host);
    if (!domain || domain.workspace.id !== String(resolved.presentation.workspaceId ?? '')) throw notEmbeddable();
  }
  if (!isEmbedAllowed(resolved.presentation)) {
    throw new ApiError(403, 'Embedding is turned off for this presentation', 'EMBED_DISABLED');
  }
  const size = fitSize(target.kind, request.maxwidth, request.maxheight);
  const src = embedPageUrl(url.origin, target);
  return {
    version: '1.0',
    type: 'rich',
    provider_name: 'Open Poll',
    provider_url: primaryOrigin(),
    title: resolved.title,
    html: iframeHtml(src, resolved.title, size),
    width: size.width,
    height: size.height,
    // Live pages change every second, but the iframe does that on its own: the HTML is stable.
    cache_age: 3600,
  };
}
