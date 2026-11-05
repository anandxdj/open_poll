import { registerLiveReducer, type LiveSubReducer, type LiveState } from "../../../live/reducer";
import type {
  AudienceParticipantView,
  AudienceWindowView,
  DeckSettings,
  HostAudienceView,
  SessionPace,
} from "../../../types";

/**
 * Audience pace live slice (`state.modules.audience`, W2-F). Every slide of an
 * audience-paced deck is open at once and each participant moves on their own,
 * so the core "current slide" state does not apply; this slice keeps:
 * - `pace` and `nickname` (code lookup, `live-state`), so the shells pick the
 *   audience views and the join form its nickname rule;
 * - `participant`: the participant's own run (`live-state.audience`, or the
 *   view a submit / retry answered with: `live/module audience/view`);
 * - `answered`: slides answered since that view arrived (an accepted answer or
 *   a queued one that synced), so the phone moves on before the re-read lands;
 * - `host`: the dashboard data (`host/state.audience`);
 * - `window`: open / closing / closed times from `audience:opened` / `audience:closed`.
 */
export const AUDIENCE_PREFIX = "audience";

export interface AudienceSlice {
  pace: SessionPace | null;
  nickname: DeckSettings["nickname"] | null;
  participant: AudienceParticipantView | null;
  answered: Record<string, true>;
  host: HostAudienceView | null;
  window: AudienceWindowView | null;
}

export const initialAudienceSlice: AudienceSlice = {
  pace: null,
  nickname: null,
  participant: null,
  answered: {},
  host: null,
  window: null,
};

const markAnswered = (state: AudienceSlice, slideId: string | null | undefined): AudienceSlice =>
  !slideId || state.answered[slideId] ? state : { ...state, answered: { ...state.answered, [slideId]: true } };

export const audienceReducer: LiveSubReducer<AudienceSlice> = (state, action) => {
  switch (action.type) {
    case "participant/info-loaded": {
      const { info } = action;
      return {
        ...state,
        pace: info.pace ?? state.pace,
        nickname: info.nickname ?? state.nickname,
        window: info.audience !== undefined ? info.audience : state.window,
      };
    }
    case "participant/live-state": {
      const view = action.state.audience ?? null;
      return {
        ...state,
        pace: action.state.pace,
        nickname: action.state.settings?.nickname ?? state.nickname,
        participant: view,
        answered: {},
        window: view?.window ?? state.window,
      };
    }
    case "participant/submitted":
      return markAnswered(state, action.slideId);
    case "participant/answer-synced":
      return markAnswered(state, action.slideId);
    case "host/state-loaded": {
      const host = action.state.audience ?? null;
      return {
        ...state,
        pace: action.state.session?.pace ?? action.state.presentation?.pace ?? state.pace,
        host,
        window: host?.window ?? action.state.session?.audience ?? state.window,
      };
    }
    case "host/command": {
      const session = action.response.session;
      return { ...state, pace: session.pace, window: session.audience ?? state.window };
    }
    case "live/module":
      if (action.prefix === AUDIENCE_PREFIX && action.name === "view") {
        const view = action.payload as AudienceParticipantView;
        return { ...state, participant: view, answered: {}, window: view.window };
      }
      return state;
    case "live/event": {
      const { type, payload } = action.event;
      if (type === "audience:opened") {
        return {
          ...state,
          window: {
            openedAt: typeof payload.openedAt === "string" ? payload.openedAt : null,
            closesAt: typeof payload.closesAt === "string" ? payload.closesAt : null,
            closedAt: null,
            closeReason: null,
          },
        };
      }
      if (type === "audience:closed") {
        const closedAt = typeof payload.closedAt === "string" ? payload.closedAt : new Date().toISOString();
        const reason = payload.reason === "host" || payload.reason === "schedule" || payload.reason === "ended" ? payload.reason : null;
        return {
          ...state,
          window: {
            openedAt: state.window?.openedAt ?? null,
            closesAt: state.window?.closesAt ?? null,
            closedAt,
            closeReason: reason,
          },
        };
      }
      return state;
    }
    default:
      return state;
  }
};

/** The slice from a live state (initial before the module registered). */
export const audienceSliceOf = (state: Pick<LiveState, "modules">): AudienceSlice =>
  (state.modules[AUDIENCE_PREFIX] as AudienceSlice | undefined) ?? initialAudienceSlice;

/** Registers the slice; returns the function that undoes it (tests). `register.ts` calls it once. */
export function registerAudienceModule(): () => void {
  return registerLiveReducer(AUDIENCE_PREFIX, audienceReducer, initialAudienceSlice);
}
