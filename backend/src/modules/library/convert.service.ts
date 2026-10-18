import { Types } from 'mongoose';
import { assertCan, type PolicyResource } from '../../common/tenancy/policy';
import { ApiError } from '../../common/utils/ApiError';
import { PollModel, type IPoll, type IQuestion } from '../polls/polls.model';
import { PresentationModel, type IPresentation } from '../presentations/presentations.model';
import { createPresentationSchema, type CreatePresentationInput } from '../presentations/presentations.schema';
import { PresentationService } from '../presentations/presentations.service';
import type { LibraryContext } from './library.service';

/**
 * "Convert to presentation": copies a poll's questions (never its responses)
 * into a new audience-paced deck of select_answer slides.
 *
 * - POLL questions become ungraded slides (0 points, no correct option).
 * - TRIAL questions keep their correct options, points and explanation, and
 *   the deck gets `settings.audiencePaced.assessment` from the poll.
 * - The deck records `legacy: {source: 'poll', sourceId}` and the poll
 *   `convertedPresentationId`; converting again returns that deck unless
 *   `force` asks for a fresh copy.
 */

/** Request-schema limits the copied text must fit so the deck stays editable. */
const MAX_TITLE = 120;
const MAX_QUESTION = 500;
const MAX_OPTION = 200;
const MAX_EXPLANATION = 2000;
const MAX_POINTS = 10000;
/** Presentation timer bounds for built-in types; audience pace ignores the timer. */
const TIME_LIMIT_SECONDS = 30;

/**
 * Assessment settings for a converted TRIAL. `maxAttempts: null` = unlimited:
 * a TRIAL lets identified respondents retry until they pass.
 */
export interface ConvertedAssessment {
  enabled: true;
  passingScorePercentage: number;
  maxAttempts: number | null;
}

export interface ConvertedDeckDraft {
  input: CreatePresentationInput;
  pace: 'audience';
  assessment: ConvertedAssessment | null;
}

type PollSource = Pick<IPoll, 'title' | 'pollType' | 'passingScorePercentage'> & {
  questions: Array<Pick<IQuestion, 'text' | 'options' | 'type' | 'correctOptionIndices' | 'explanation' | 'points'>>;
};

const clip = (value: string, max: number) => value.trim().slice(0, max);

/** The deck a poll converts to, validated by the presentations request schema. */
export function pollToDeckDraft(poll: PollSource): ConvertedDeckDraft {
  const graded = poll.pollType === 'TRIAL';
  const slides = poll.questions.map((question) => {
    const correct = new Set(graded ? (question.correctOptionIndices ?? []) : []);
    return {
      type: 'select_answer',
      question: clip(question.text, MAX_QUESTION),
      options: question.options.map((text, index) => ({ text: clip(text, MAX_OPTION), isCorrect: correct.has(index) })),
      timeLimit: TIME_LIMIT_SECONDS,
      points: graded ? Math.min(MAX_POINTS, Math.max(1, Math.round(question.points ?? 1))) : 0,
      scoreDependsOnTime: false,
      config: {
        allowMultiple: question.type === 'multiple',
        explanation: clip(question.explanation ?? '', MAX_EXPLANATION),
      },
    };
  });

  const parsed = createPresentationSchema.safeParse({ title: clip(poll.title, MAX_TITLE) || 'Untitled poll', slides });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const [root, index] = issue.path;
      return root === 'slides' && typeof index === 'number' ? `question ${index + 1}: ${issue.message}` : issue.message;
    });
    throw new ApiError(400, `This poll cannot be converted: ${[...new Set(problems)].join('; ')}`, 'POLL_NOT_CONVERTIBLE');
  }

  return {
    input: parsed.data,
    pace: 'audience',
    assessment: graded
      ? { enabled: true, passingScorePercentage: poll.passingScorePercentage ?? 70, maxAttempts: null }
      : null,
  };
}

export interface ConvertResult {
  created: boolean;
  presentation: IPresentation;
}

/**
 * The live (not trashed) deck the poll records as its conversion. Only the
 * poll's pointer counts: a deck carrying `legacy.sourceId` without it is a
 * concurrent conversion that may still lose (and be deleted).
 */
async function existingConversion(poll: IPoll): Promise<IPresentation | null> {
  if (!poll.convertedPresentationId) return null;
  return PresentationModel.findOne({ _id: poll.convertedPresentationId, deletedAt: null });
}

async function loadPoll(pollId: string): Promise<IPoll> {
  const poll = await PollModel.findById(pollId);
  if (!poll) throw ApiError.notFound('Poll not found');
  return poll;
}

/**
 * The policy fields of a poll or deck, read with `get()` so a `workspaceId`
 * stored before the schema declares it (polls until W1-B) still counts.
 */
const policyResource = (doc: IPoll | IPresentation): PolicyResource => ({
  workspaceId: (doc.get('workspaceId') as PolicyResource['workspaceId']) ?? null,
  creatorId: doc.get('creatorId') as string,
});

function readable(ctx: LibraryContext, deck: IPresentation): IPresentation {
  assertCan(ctx, 'deck:read', policyResource(deck));
  return deck;
}

export class ConvertService {
  static async convertPoll(ctx: LibraryContext, pollId: string, options: { force?: boolean } = {}): Promise<ConvertResult> {
    assertCan(ctx, 'deck:create');
    const poll = await loadPoll(pollId);
    // Recording the conversion changes the poll, so its editors convert it.
    assertCan(ctx, 'deck:edit', policyResource(poll));

    if (!options.force) {
      const existing = await existingConversion(poll);
      if (existing) return { created: false, presentation: readable(ctx, existing) };
    }

    const draft = pollToDeckDraft(poll);
    const deck = await PresentationService.createPresentation(draft.input, ctx.user.id);
    let recorded = false;
    try {
      // Deck-level fields the create request does not carry (pace, legacy,
      // assessment, workspace). strict:false keeps them whatever the schema in force.
      const set: Record<string, unknown> = {
        pace: draft.pace,
        legacy: { source: 'poll', sourceId: poll._id },
        workspaceId: new Types.ObjectId(String(ctx.workspace._id)),
      };
      if (draft.assessment) set['settings.audiencePaced.assessment'] = draft.assessment;
      await PresentationModel.updateOne({ _id: deck._id }, { $set: set }, { strict: false });

      // Only the request that saw the poll's previous state records itself; a
      // concurrent conversion that got there first wins.
      const update = await PollModel.updateOne(
        { _id: poll._id, convertedPresentationId: poll.convertedPresentationId ?? null },
        { $set: { convertedPresentationId: deck._id } },
        { timestamps: false },
      );
      recorded = update.matchedCount === 1;
    } finally {
      // A fresh deck has no session data, so dropping the document is enough.
      if (!recorded) await PresentationModel.deleteOne({ _id: deck._id }).catch(() => {});
    }

    if (!recorded) {
      const winner = await existingConversion(await loadPoll(pollId));
      if (!winner) throw ApiError.conflict('The poll changed while converting, please retry');
      return { created: false, presentation: readable(ctx, winner) };
    }

    const presentation = await PresentationModel.findById(deck._id);
    if (!presentation) throw ApiError.internal('Converted deck disappeared');
    return { created: true, presentation };
  }
}
