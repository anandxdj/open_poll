import { z } from 'zod';
import { ApiError } from '../../../common/utils/ApiError';
import { PresentationService } from '../../presentations/presentations.service';
import type { IPresentation } from '../../presentations/models/presentation.model';
import type { SessionView } from '../../presentations/live/contract';
import { CustomDomainModel } from '../../domains/customDomain.model';
import {
  AUDIENCE_TEXT_NOTE,
  auditMcp,
  frontendUrl,
  parseObjectId,
  workspaceScope,
  type McpScopeContext,
  type McpUserContext,
} from '../mcp.context';
import { agentKindOf } from './decks';
import { agentDistribution, agentLeaderboard, slideLabel } from './resultViews';
import { defineTool } from './types';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Where people join: the main site, plus each active custom domain of the deck's workspace. */
async function joinInfo(deck: IPresentation, scope: McpScopeContext) {
  const web = frontendUrl();
  const code = deck.joinCode;
  const domains = await CustomDomainModel.find({
    workspaceId: deck.workspaceId ?? scope.workspace._id,
    status: 'active',
  })
    .select('hostname')
    .lean();
  return {
    code,
    url: `${web}/live/${code}`,
    enterCodeAt: `${web}/live`,
    customDomainUrls: domains.map((domain) => `https://${domain.hostname}/live/${code}`),
    hostScreen: `${web}/presentation/host/${String(deck._id)}`,
  };
}

/** The session as an agent narrates it: counts and the current slide, no participant list. */
function liveView(deck: IPresentation, session: SessionView | null) {
  if (!session) return null;
  const current = session.current;
  const slide = current ? deck.slides[current.slideIndex] : undefined;
  return {
    sessionId: session.sessionId,
    runNumber: session.runNumber,
    status: session.status,
    isLive: session.isLive,
    pace: session.pace,
    joinCode: session.joinCode,
    participantCount: session.participantCount,
    answerCount: session.answerCount,
    audienceCap: session.audienceCap,
    totalSlides: session.totalSlides,
    current: current
      ? {
          position: current.slideIndex,
          slideId: current.slideId,
          kind: slide ? agentKindOf(slide) : current.type,
          label: slideLabel(slide),
          phase: current.phase,
          scored: current.scored,
          answeredCount: current.answeredCount,
          endsAt: current.endsAt,
          isLastSlide: current.isLastSlide,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const deckId = z.string().min(1).describe('Deck id');
const deckIdShape = { deckId };

const isLive = (deck: IPresentation) => deck.status === 'lobby' || deck.status === 'active';

type HostCommand = (id: string, scope: McpScopeContext) => Promise<{ presentation: IPresentation; session: SessionView }>;

/** Runs a host command (policy `deck:host`) and answers with the session view. */
async function runCommand(ctx: McpUserContext, rawDeckId: unknown, action: string, command: HostCommand) {
  const id = parseObjectId(rawDeckId, 'deck id');
  const scope = await workspaceScope(ctx);
  const { presentation, session } = await command(id, scope);
  auditMcp(ctx, scope, `session.${action}`, { type: 'presentation', id }, { sessionId: session.sessionId });
  return { presentation, scope, session: liveView(presentation, session) };
}

export const LIVE_TOOLS = [
  defineTool({
    name: 'open_lobby',
    scope: 'session:run',
    description:
      'Open a new live session of a deck in its lobby, so people can join on their phones with the join code or link this returns. Share the join link (or put the host screen on a projector) and call start_session when the room is ready. Refuses while a session of the deck is already live unless restart is true, which ends that session for everyone first.',
    inputShape: {
      deckId,
      restart: z
        .boolean()
        .optional()
        .describe('End the session that is live right now (everyone in it is moved to the end screen) and open a fresh lobby'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    async handler(args, ctx) {
      const parsed = z.object({ deckId, restart: z.boolean().optional() }).parse(args);
      const id = parseObjectId(parsed.deckId, 'deck id');
      const scope = await workspaceScope(ctx);
      const deck = await PresentationService.getPresentationFor(id, scope);
      if (isLive(deck) && !parsed.restart) {
        throw new ApiError(
          409,
          `A session of this deck is already ${deck.status === 'lobby' ? 'in its lobby' : 'running'}. Keep using it (start_session, next_slide, get_live_state), or pass restart: true to end it and open a fresh lobby.`,
          'SESSION_ALREADY_LIVE',
        );
      }
      const result = await runCommand(ctx, id, 'open_lobby', PresentationService.openLobby);
      return {
        session: result.session,
        join: await joinInfo(result.presentation, scope),
        next: 'Share join.url (or show join.hostScreen on a projector). Call start_session when people are in; get_live_state shows how many joined.',
      };
    },
  }),

  defineTool({
    name: 'start_session',
    scope: 'session:run',
    description:
      'Start presenting: moves the session from its lobby to the first slide (opens a session straight on slide 1 when none is live). Refuses when the deck is already being presented.',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const { session } = await runCommand(ctx, args?.deckId, 'start', PresentationService.startSession);
      return { session };
    },
  }),

  defineTool({
    name: 'next_slide',
    scope: 'session:run',
    description:
      'Move everyone to the next slide. Leaving a slide that is still taking answers closes it. On the last slide, call end_session instead.',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const id = parseObjectId(args?.deckId, 'deck id');
      const deck = await PresentationService.getPresentationFor(id, await workspaceScope(ctx));
      if (isLive(deck) && deck.currentSlideIndex >= deck.slides.length - 1) {
        throw ApiError.badRequest('This is the last slide. Call end_session to finish, or go_to_slide to revisit one.');
      }
      const { session } = await runCommand(ctx, id, 'next', (deckIdArg, scope) => PresentationService.advanceSlide(deckIdArg, scope));
      return { session };
    },
  }),

  defineTool({
    name: 'previous_slide',
    scope: 'session:run',
    description: 'Move everyone back one slide. A slide that already took answers comes back closed, with its results.',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const id = parseObjectId(args?.deckId, 'deck id');
      const deck = await PresentationService.getPresentationFor(id, await workspaceScope(ctx));
      if (deck.currentSlideIndex <= 0) throw ApiError.badRequest('Already on the first slide (or in the lobby)');
      const { session } = await runCommand(ctx, id, 'previous', (deckIdArg, scope) =>
        PresentationService.gotoSlide(deckIdArg, scope, { slideIndex: deck.currentSlideIndex - 1 }),
      );
      return { session };
    },
  }),

  defineTool({
    name: 'go_to_slide',
    scope: 'session:run',
    description: 'Move everyone to a given slide, forwards or backwards, by 0-based position or by slide id (from get_deck).',
    inputShape: {
      deckId,
      position: z.number().int().min(0).optional().describe('0-based slide position'),
      slideId: z.string().min(1).optional().describe('Slide id; use instead of position'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const parsed = z
        .object({ deckId, position: z.number().int().min(0).optional(), slideId: z.string().min(1).optional() })
        .refine((data) => (data.position === undefined) !== (data.slideId === undefined), 'Pass either position or slideId')
        .parse(args);
      const target = parsed.slideId !== undefined ? { slideId: parsed.slideId } : { slideIndex: parsed.position };
      const { session } = await runCommand(ctx, parsed.deckId, 'goto', (id, scope) => PresentationService.gotoSlide(id, scope, target));
      return { session };
    },
  }),

  defineTool({
    name: 'close_voting',
    scope: 'session:run',
    description: 'Stop taking answers on the current slide without showing results yet (polls, quiz questions, word clouds...).',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const { session } = await runCommand(ctx, args?.deckId, 'close', PresentationService.closeCurrentSlide);
      return { session };
    },
  }),

  defineTool({
    name: 'reveal_results',
    scope: 'session:run',
    description:
      'Show the current slide\'s results on the stage (and correct answers for quiz questions); closes answering first. Returns the results so you can comment on them.',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const { session, presentation, scope } = await runCommand(ctx, args?.deckId, 'reveal', PresentationService.revealCurrentSlide);
      const state = await PresentationService.getHostState(String(presentation._id), scope);
      return {
        session,
        results: agentDistribution(state.liveDistribution),
        leaderboard: session?.current?.scored ? agentLeaderboard(state.leaderboard) : undefined,
        note: AUDIENCE_TEXT_NOTE,
      };
    },
  }),

  defineTool({
    name: 'end_session',
    scope: 'session:run',
    description:
      'End the live session for everyone: phones show the end screen and the results are saved to the session history. Only when the user wants to finish.',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      const { session } = await runCommand(ctx, args?.deckId, 'end', PresentationService.endPresentation);
      return {
        session,
        next: session ? `get_session_results with sessionId ${session.sessionId} has the full results.` : undefined,
      };
    },
  }),

  defineTool({
    name: 'get_live_state',
    scope: 'session:run',
    description:
      'The live (else most recent) session of a deck: status, how many people joined and answered, the current slide and its results so far, and the top of the leaderboard.',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const id = parseObjectId(args?.deckId, 'deck id');
      const scope = await workspaceScope(ctx);
      const state = await PresentationService.getHostState(id, scope);
      return {
        session: liveView(state.presentation, state.session),
        currentResults: agentDistribution(state.liveDistribution),
        leaderboard: agentLeaderboard(state.leaderboard),
        note: AUDIENCE_TEXT_NOTE,
      };
    },
  }),

  defineTool({
    name: 'get_join_link',
    scope: 'deck:read',
    description:
      'The join code and links people open on their phones for a deck (the code stays the same for every session of the deck), and whether a lobby is open right now.',
    inputShape: deckIdShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const id = parseObjectId(args?.deckId, 'deck id');
      const scope = await workspaceScope(ctx);
      const deck = await PresentationService.getPresentationFor(id, scope);
      return {
        join: await joinInfo(deck, scope),
        status: deck.status,
        note: isLive(deck)
          ? 'A session is live: people can join now.'
          : 'No session is live: people can only join after open_lobby.',
      };
    },
  }),
];
