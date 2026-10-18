import * as crud from './crud.service';
import * as session from './live/session.service';
import * as answers from './live/answer.service';
import * as participants from './live/participant.service';
import type { IPresentation } from './presentations.model';
import type {
  CreatePresentationInput,
  UpdatePresentationInput,
  JoinPresentationInput,
  SubmitPresentationAnswerInput,
} from './presentations.schema';

/**
 * Facade over the presentations module. Callers outside the module (socket,
 * MCP, AI, worker, controllers) use this; the work lives in `crud.service.ts`
 * and `live/*`. Signatures here are the module's stable public API.
 */

export { publishPresentationEvent } from './live/events';
export { computeSlideDistributionHelper } from './live/distribution';

export class PresentationService {
  // ---------- CRUD (creator) ----------

  static createPresentation(data: CreatePresentationInput, creatorId: string) {
    return crud.createPresentation(data, creatorId);
  }

  static getPresentationById(presentationId: string) {
    return crud.getPresentationById(presentationId);
  }

  static assertOwnership(presentationId: string, userId: string): Promise<IPresentation> {
    return crud.assertOwnership(presentationId, userId);
  }

  // Non-throwing checks for the socket layer, which just needs a yes/no.
  static isOwner(presentationId: string, userId: string): Promise<boolean> {
    return crud.isOwner(presentationId, userId);
  }

  static isAuthorizedParticipant(presentationId: string, participantId: string, token: string): Promise<boolean> {
    return participants.isAuthorizedParticipant(presentationId, participantId, token);
  }

  static listPresentationsByCreator(creatorId: string) {
    return crud.listPresentationsByCreator(creatorId);
  }

  static updatePresentation(presentationId: string, userId: string, data: UpdatePresentationInput) {
    return crud.updatePresentation(presentationId, userId, data);
  }

  static deletePresentation(presentationId: string, userId: string) {
    return crud.deletePresentation(presentationId, userId);
  }

  // ---------- Host session controls ----------

  static openLobby(presentationId: string, userId: string) {
    return session.openLobby(presentationId, userId);
  }

  static advanceSlide(presentationId: string, userId: string, targetIndex?: number) {
    return session.advanceSlide(presentationId, userId, targetIndex);
  }

  static revealCurrentSlide(presentationId: string, userId: string) {
    return session.revealCurrentSlide(presentationId, userId);
  }

  static endPresentation(presentationId: string, userId: string) {
    return session.endPresentation(presentationId, userId);
  }

  static getHostState(presentationId: string, userId: string) {
    return session.getHostState(presentationId, userId);
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
}
