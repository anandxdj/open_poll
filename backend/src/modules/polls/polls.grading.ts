import { z } from 'zod';
import { ApiError } from '../../common/utils/ApiError';

// Gradeability rules for assessments (pollType 'TRIAL'), shared by the REST
// routes, PollService and the MCP tools so the surfaces cannot disagree on what
// "gradeable" means.
//
// Why it matters: ResponseService grades a question as correct when the
// respondent's picks equal correctOptionIndices exactly. With [] stored, skipping
// the question scores it correct; with an index past the end of options, nobody
// can ever score it.

export type QuestionWithAnswers = {
  options: string[];
  type?: 'single' | 'multiple';
  correctOptionIndices?: number[];
};

/**
 * Problems with the correct answers a question DOES declare. An empty list is not
 * flagged here — whether answers are required depends on the poll (see
 * assertQuestionsGradeable).
 */
export function answerIndexProblems(question: QuestionWithAnswers): string[] {
  const problems: string[] = [];
  const indices = question.correctOptionIndices ?? [];
  const optionCount = question.options.length;

  // polls.schema.ts only bounds indices below (int().min(0)), so an index past the
  // end of options would persist and silently mark the question ungradeable.
  for (const index of indices) {
    if (index >= optionCount) {
      problems.push(
        `correctOptionIndices contains ${index}, but this question only has ${optionCount} options (valid range 0-${optionCount - 1})`,
      );
    }
  }

  if (question.type === 'single' && indices.length > 1) {
    problems.push('A "single" question can have at most one correct option; use type "multiple" instead');
  }

  return problems;
}

/** zod superRefine adapter for a single question object. */
export function checkAnswerIndices(question: QuestionWithAnswers, ctx: z.RefinementCtx) {
  for (const message of answerIndexProblems(question)) {
    ctx.addIssue({ code: 'custom', path: ['correctOptionIndices'], message });
  }
}

/**
 * Throws 400 unless every question can be graded: at least one correct option,
 * every index in range, and no more than one for a "single" question.
 */
export function assertQuestionsGradeable(questions: QuestionWithAnswers[]) {
  const answerless = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => !question.correctOptionIndices?.length)
    .map(({ index }) => index + 1);

  const problems = questions.flatMap((question, index) =>
    answerIndexProblems(question).map((problem) => `question ${index + 1}: ${problem}`),
  );

  const messages: string[] = [];
  if (answerless.length) {
    messages.push(
      `This poll is a graded assessment, so every question needs correctOptionIndices. Missing on question(s): ${answerless.join(', ')}.`,
    );
  }
  if (problems.length) {
    messages.push(`Invalid correct answers — ${problems.join('; ')}.`);
  }

  if (messages.length) {
    throw ApiError.badRequest(messages.join(' '));
  }
}
