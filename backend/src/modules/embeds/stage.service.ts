import { ApiError } from '../../common/utils/ApiError';
import type { IPresentation } from '../presentations/models/presentation.model';
import type { IPresentationSession } from '../presentations/models/session.model';
import type { HostStateResponse, SlideResultsView } from '../presentations/live/contract';
import { buildDeckLiveState } from '../presentations/live/session.service';
import { readSlideState } from '../presentations/live/state';
import { authorizeScreen, resolveScreenToken, isEmbedAllowed } from './screenTokens.service';
import { isRevealed, stageSafeSlide, stripAnswerKeys } from './stageSafe';

/**
 * The deck as a screen sees it: what the stage draws, nothing the host keeps
 * to itself. Slides go through `stageSafeSlide`; ids, title, join code, status,
 * pace and the audience settings stay.
 */
export interface ScreenDeck {
  _id: string;
  title: string;
  joinCode: string;
  status: IPresentation['status'];
  pace: IPresentation['pace'];
  currentSlideIndex: number;
  settings: IPresentation['settings'];
  slides: Record<string, unknown>[];
}

/**
 * `GET /api/embeds/stage` and the `screen` role's `live:resync`: the host
 * state's shape (so the stage renders it with the host's reducer) over a
 * stage-safe deck. Results of slides that are not revealed yet keep their
 * counts but lose their answer key (`stripAnswerKeys`); the host's user id is
 * not sent.
 */
export type ScreenStateResponse = HostStateResponse<ScreenDeck>;

const EMBED_DISABLED = () =>
  new ApiError(403, 'Embedding is turned off for this presentation', 'EMBED_DISABLED');
const SCREEN_NOT_FOUND = () => ApiError.notFound('This screen link does not work any more');

const revealedIn = (session: IPresentationSession | null, slideId: string) =>
  session ? isRevealed(readSlideState(session, slideId)) : false;

/** Pure: the host state of a deck turned into what its screens may see. */
export function toScreenState(
  presentation: IPresentation,
  state: HostStateResponse<IPresentation>,
  session: IPresentationSession | null,
): ScreenStateResponse {
  const plain = presentation.toObject({ depopulate: true }) as unknown as {
    slides: Parameters<typeof stageSafeSlide>[0][];
  };
  const deck: ScreenDeck = {
    _id: String(presentation._id),
    title: presentation.title,
    joinCode: presentation.joinCode,
    status: presentation.status,
    pace: presentation.pace,
    currentSlideIndex: presentation.currentSlideIndex,
    settings: presentation.settings,
    slides: plain.slides.map((slide) => {
      const id = String(slide._id);
      return { ...stageSafeSlide(slide, revealedIn(session, id)), _id: id };
    }),
  };

  const distributions: Record<string, SlideResultsView> = {};
  for (const [slideId, results] of Object.entries(state.distributions)) {
    distributions[slideId] = revealedIn(session, slideId) ? results : stripAnswerKeys(results);
  }
  const currentId = state.session?.currentSlideId ?? null;
  const liveDistribution =
    state.liveDistribution && !(currentId && revealedIn(session, currentId))
      ? stripAnswerKeys(state.liveDistribution)
      : state.liveDistribution;

  return {
    quiz: deck,
    presentation: deck,
    serverNow: state.serverNow,
    session: state.session ? { ...state.session, hostUserId: null } : null,
    participants: state.participants,
    answeredCount: state.answeredCount,
    liveDistribution,
    leaderboard: state.leaderboard,
    slideStates: state.slideStates,
    distributions,
  };
}

async function screenStateOf(presentation: IPresentation): Promise<ScreenStateResponse> {
  const { state, session } = await buildDeckLiveState(presentation);
  return toScreenState(presentation, state, session);
}

/**
 * The stage of the deck a screen token belongs to. 404 for a token that does
 * not work (malformed, unknown, revoked, deck deleted); 403 `EMBED_DISABLED`
 * when the deck does not allow embedding.
 */
export async function getScreenStateByToken(secret: unknown): Promise<ScreenStateResponse> {
  const resolved = await resolveScreenToken(secret);
  if (!resolved) throw SCREEN_NOT_FOUND();
  if (!isEmbedAllowed(resolved.presentation)) throw EMBED_DISABLED();
  return screenStateOf(resolved.presentation);
}

/** The same for a socket that names its deck: the token must belong to that deck. */
export async function getScreenState(presentationId: string, secret: unknown): Promise<ScreenStateResponse> {
  const resolved = await authorizeScreen(presentationId, secret);
  if (!resolved) throw new ApiError(403, 'This screen may not follow that presentation', 'FORBIDDEN');
  return screenStateOf(resolved.presentation);
}
