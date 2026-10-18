import * as access from './access';
import * as crud from './crud.service';
import * as session from './live/session.service';
import * as answers from './live/answer.service';
import * as participants from './live/participant.service';
import type { Actor } from './access';
import type { ListContext } from './crud.service';
import type { IPresentation } from './presentations.model';
import type {
  CreatePresentationInput,
  UpdatePresentationInput,
  JoinPresentationInput,
  SubmitPresentationAnswerInput,
  GotoSlideInput,
} from './presentations.schema';

/**
 * Facade over the presentations module. Callers outside the module (socket,
 * MCP, AI, worker, controllers) use this; the work lives in `access.ts`,
 * `crud.service.ts` and `live/*`. Signatures here are the module's stable
 * public API.
 *
 * `actor` is the request (policy context after `authenticate()` +
 * `workspaceContext()`) or a bare user id (sockets, scripts, tests), which is
 * checked against the deck's own workspace.
 */

export { publishPresentationEvent } from './live/events';
export { computeSlideDistributionHelper } from './live/distribution';
export type { Actor } from './access';
export type { HostCommandResult } from './live/session.service';

export class PresentationService {
  // ---------- CRUD (creator) ----------

  static createPresentation(data: CreatePresentationInput, actor: Actor) {
    return crud.createPresentation(data, actor);
  }

  static getPresentationById(presentationId: string) {
    return access.getPresentationById(presentationId);
  }

  /** The deck, after checking `deck:read` for the actor. */
  static getPresentationFor(presentationId: string, actor: Actor): Promise<IPresentation> {
    return access.authorizeDeck(presentationId, actor, 'deck:read');
  }

  // Non-throwing checks for the socket layer, which just needs a yes/no.
  static canHost(presentationId: string, userId: string): Promise<boolean> {
    return access.canActOnDeck(presentationId, userId, 'deck:host');
  }

  static isAuthorizedParticipant(presentationId: string, participantId: string, token: string): Promise<boolean> {
    return participants.isAuthorizedParticipant(presentationId, participantId, token);
  }

  /** Decks of the request's workspace. */
  static listPresentations(ctx: ListContext) {
    return crud.listPresentations(ctx);
  }

  static updatePresentation(presentationId: string, actor: Actor, data: UpdatePresentationInput) {
    return crud.updatePresentation(presentationId, actor, data);
  }

  static deletePresentation(presentationId: string, actor: Actor) {
    return crud.deletePresentation(presentationId, actor);
  }

  // ---------- Host session controls ----------

  static openLobby(presentationId: string, actor: Actor) {
    return session.openLobby(presentationId, actor);
  }

  static startSession(presentationId: string, actor: Actor) {
    return session.startSession(presentationId, actor);
  }

  static gotoSlide(presentationId: string, actor: Actor, target: GotoSlideInput) {
    return session.gotoSlide(presentationId, actor, target);
  }

  /** Legacy alias: `gotoSlide` to `targetIndex`, default the next slide. */
  static advanceSlide(presentationId: string, actor: Actor, targetIndex?: number) {
    return session.advanceSlide(presentationId, actor, targetIndex);
  }

  static closeCurrentSlide(presentationId: string, actor: Actor) {
    return session.closeCurrentSlide(presentationId, actor);
  }

  static reopenCurrentSlide(presentationId: string, actor: Actor) {
    return session.reopenCurrentSlide(presentationId, actor);
  }

  static revealCurrentSlide(presentationId: string, actor: Actor) {
    return session.revealCurrentSlide(presentationId, actor);
  }

  static endPresentation(presentationId: string, actor: Actor) {
    return session.endPresentation(presentationId, actor);
  }

  static getHostState(presentationId: string, actor: Actor) {
    return session.getHostState(presentationId, actor);
  }

  static listSessions(presentationId: string, actor: Actor) {
    return session.listSessions(presentationId, actor);
  }

  // ---------- Participant flow (public) ----------

  static getPresentationByCode(joinCode: string) {
    return session.getPresentationByCode(joinCode);
  }

  static joinPresentation(presentationId: string, data: JoinPresentationInput) {
    return participants.joinPresentation(presentationId, data);
  }

  /** HOT PATH — runs entirely on Redis; Mongo writes are async write-behind. */
  static submitAnswer(presentationId: string, data: SubmitPresentationAnswerInput) {
    return answers.submitAnswer(presentationId, data);
  }

  static getParticipantState(presentationId: string, participantId: string, token: string) {
    return participants.getParticipantState(presentationId, participantId, token);
  }

  static getParticipantLiveState(presentationId: string, participantId: string, token: string) {
    return participants.getParticipantLiveState(presentationId, participantId, token);
  }
}
