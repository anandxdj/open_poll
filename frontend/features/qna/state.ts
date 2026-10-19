import type { LiveAction, LiveState, LiveSubReducer } from "@/features/presentations/live/reducer";
import {
  isPublicStatus,
  type QnaEventPayloads,
  type QnaHostListResponse,
  type QnaHostQuestion,
  type QnaParticipantListResponse,
  type QnaParticipantQuestion,
  type QnaQuestionView,
  type QnaSettingsView,
  type QnaUpvoteResponse,
  type ReactionSettingsView,
} from "./types";

/**
 * The Q&A slice of the live store (`state.modules.qna`). One shape for both
 * roles: a question is the public view plus what the role knows about it
 * (`mine`/`upvoted` for a participant, `participantId`/`highlighted` for the
 * host). Events carry only the public view, so they merge into what is there.
 */
export const QNA_PREFIX = "qna";

export interface QnaItem extends QnaQuestionView {
  /** Participant: asked by this participant. */
  mine?: boolean;
  /** Participant: this participant upvoted it. */
  upvoted?: boolean;
  /** Host: the asker's id; null for anonymous questions. */
  participantId?: string | null;
}

export interface QnaState {
  /** The list endpoint answered for the current session. */
  loaded: boolean;
  sessionId: string | null;
  settings: QnaSettingsView | null;
  reactions: ReactionSettingsView | null;
  items: Record<string, QnaItem>;
  highlightedId: string | null;
  /** A Q&A slide is on screen, from slide events; null until one arrived (then `settings.onBoard` counts). */
  onBoard: boolean | null;
}

export const initialQnaState: QnaState = {
  loaded: false,
  sessionId: null,
  settings: null,
  reactions: null,
  items: {},
  highlightedId: null,
  onBoard: null,
};

// ---------- Module actions (dispatched as `live/module` with prefix "qna") ----------

export const qnaActions = {
  loadedForParticipant: (response: QnaParticipantListResponse): LiveAction => ({
    type: "live/module",
    prefix: QNA_PREFIX,
    name: "loaded",
    payload: response,
  }),
  loadedForHost: (response: QnaHostListResponse): LiveAction => ({
    type: "live/module",
    prefix: QNA_PREFIX,
    name: "loaded",
    payload: response,
  }),
  asked: (question: QnaParticipantQuestion): LiveAction => ({
    type: "live/module",
    prefix: QNA_PREFIX,
    name: "asked",
    payload: question,
  }),
  voted: (result: QnaUpvoteResponse): LiveAction => ({
    type: "live/module",
    prefix: QNA_PREFIX,
    name: "voted",
    payload: result,
  }),
  hostUpdated: (question: QnaHostQuestion): LiveAction => ({
    type: "live/module",
    prefix: QNA_PREFIX,
    name: "host-updated",
    payload: question,
  }),
};

// ---------- Reducer ----------

type EventOf<T extends keyof QnaEventPayloads> = QnaEventPayloads[T];

const upsert = (state: QnaState, view: QnaQuestionView, extra: Partial<QnaItem> = {}): QnaState => {
  const previous = state.items[view.id];
  return { ...state, items: { ...state.items, [view.id]: { ...previous, ...view, ...extra } } };
};

const without = (items: QnaState["items"], id: string) => {
  const next = { ...items };
  delete next[id];
  return next;
};

const slideTypeOf = (payload: Record<string, unknown>): string | null => {
  const slide = payload.slide as { type?: unknown } | undefined;
  return typeof slide?.type === "string" ? slide.type : null;
};

/**
 * A new session starts from nothing: its own questions, its own settings. The legacy copies
 * (`lobby:opened`, `quiz:ended`) are ignored like the core reducer ignores them; the `session:*`
 * events carry the same information.
 */
const NEW_SESSION_EVENTS = new Set(["session:lobby"]);
const SLIDE_EVENTS = new Set(["slide:shown", "question:started"]);
const NO_SLIDE_EVENTS = new Set(["leaderboard:shown", "session:ended"]);

function reduceEvent(state: QnaState, event: Extract<LiveAction, { type: "live/event" }>["event"], root: LiveState): QnaState {
  if (NEW_SESSION_EVENTS.has(event.type)) return state === initialQnaState ? state : initialQnaState;

  if (SLIDE_EVENTS.has(event.type)) {
    const onBoard = slideTypeOf(event.payload) === "qna";
    return state.onBoard === onBoard ? state : { ...state, onBoard };
  }
  if (NO_SLIDE_EVENTS.has(event.type)) return state.onBoard === false ? state : { ...state, onBoard: false };

  if (!event.type.startsWith("qna:")) return state;
  // Events of another session (a previous run still draining) are not ours.
  if (state.sessionId && event.sessionId && event.sessionId !== state.sessionId) return state;

  switch (event.type) {
    case "qna:question": {
      const { question } = event.payload as unknown as EventOf<"qna:question">;
      if (!question) return state;
      // The asker already has its own question from the POST response.
      return upsert(state, question);
    }
    case "qna:updated": {
      const { question } = event.payload as unknown as EventOf<"qna:updated">;
      if (!question) return state;
      const known = state.items[question.id];
      // A participant who is not the author no longer sees a question that left the public lists.
      if (root.role === "participant" && !isPublicStatus(question.status) && !known?.mine) {
        const items = without(state.items, question.id);
        return { ...state, items, highlightedId: state.highlightedId === question.id ? null : state.highlightedId };
      }
      const next = upsert(state, question);
      if (!isPublicStatus(question.status) && next.highlightedId === question.id) {
        return { ...next, highlightedId: null };
      }
      return next;
    }
    case "qna:votes": {
      const { votes } = event.payload as unknown as EventOf<"qna:votes">;
      if (!Array.isArray(votes)) return state;
      let items: QnaState["items"] | null = null;
      for (const vote of votes) {
        const current = (items ?? state.items)[vote.id];
        if (!current || current.upvoteCount === vote.upvoteCount) continue;
        items ??= { ...state.items };
        items[vote.id] = { ...current, upvoteCount: vote.upvoteCount };
      }
      return items ? { ...state, items } : state;
    }
    case "qna:highlight": {
      const { question } = event.payload as unknown as EventOf<"qna:highlight">;
      if (!question) return state.highlightedId === null ? state : { ...state, highlightedId: null };
      return { ...upsert(state, question), highlightedId: question.id };
    }
    default:
      return state;
  }
}

function reduceModule(state: QnaState, name: string, payload: unknown): QnaState {
  switch (name) {
    case "loaded": {
      const response = payload as QnaParticipantListResponse | QnaHostListResponse;
      const items: QnaState["items"] = {};
      for (const question of response.questions) items[question.id] = question;
      return {
        loaded: true,
        sessionId: response.sessionId,
        settings: response.qna,
        reactions: "reactions" in response ? response.reactions : state.reactions,
        items,
        highlightedId: response.highlightedId,
        // The list knows whether a Q&A slide is on screen now; later slide events refine it.
        onBoard: null,
      };
    }
    case "asked": {
      const question = payload as QnaParticipantQuestion;
      return upsert(state, question, { mine: true, upvoted: false });
    }
    case "voted": {
      const result = payload as QnaUpvoteResponse;
      const current = state.items[result.questionId];
      if (!current) return state;
      return {
        ...state,
        items: {
          ...state.items,
          [result.questionId]: { ...current, upvoted: result.upvoted, upvoteCount: result.upvoteCount },
        },
      };
    }
    case "host-updated": {
      const question = payload as QnaHostQuestion;
      const { highlighted, ...view } = question;
      const next = upsert(state, view);
      if (highlighted) return { ...next, highlightedId: question.id };
      return next.highlightedId === question.id ? { ...next, highlightedId: null } : next;
    }
    default:
      return state;
  }
}

export const qnaReducer: LiveSubReducer<QnaState> = (state, action, root) => {
  if (action.type === "live/module") return action.prefix === QNA_PREFIX ? reduceModule(state, action.name, action.payload) : state;
  if (action.type === "live/event") return reduceEvent(state, action.event, root);
  return state;
};

// ---------- Selectors (pure, over the slice) ----------

export type QnaSort = "top" | "new";

/** Pinned first, then by votes (`top`) or by time (`new`); ties fall back to newest. */
export function sortQuestions(items: readonly QnaItem[], sort: QnaSort): QnaItem[] {
  const byNew = (a: QnaItem, b: QnaItem) => b.createdAt.localeCompare(a.createdAt);
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "top" && a.upvoteCount !== b.upvoteCount) return b.upvoteCount - a.upvoteCount;
    return byNew(a, b);
  });
}

/** Questions with `status`, or the ones participants see (visible + answered) for `"public"`. */
export function questionsWithStatus(state: QnaState, status: QnaItem["status"] | "public"): QnaItem[] {
  return Object.values(state.items).filter((item) =>
    status === "public" ? isPublicStatus(item.status) : item.status === status
  );
}

/** Participants may ask now: Q&A is on for the deck, or a Q&A slide is on screen; and the session runs. */
export function isQnaOpen(state: QnaState, status: LiveState["status"]): boolean {
  if (!state.settings || status === "ended") return false;
  const onBoard = state.onBoard ?? state.settings.onBoard;
  return state.settings.enabled || onBoard;
}

/** The question over the stage, if any. */
export const highlightedItem = (state: QnaState): QnaItem | null =>
  state.highlightedId ? (state.items[state.highlightedId] ?? null) : null;
