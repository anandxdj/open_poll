/**
 * Starter templates (W3-B2): ready-to-run decks every workspace sees on the
 * templates page. They live in code, not in the database, so a deploy updates
 * them everywhere; "Use template" copies one into the workspace as a new draft
 * (`templates.service.ts`). Each deck is a create request body: it is validated
 * by `createPresentationSchema` when used, and `tests/templates.seeds.test.ts`
 * parses every one, so a broken seed fails the build, never a user.
 *
 * Ids are stable slugs (they are the template ids in the API); never reuse one
 * for a different deck.
 */

export const SEED_CATEGORIES = ['Meetings', 'Events', 'Education', 'Company'] as const;
export type SeedCategory = (typeof SEED_CATEGORIES)[number];

export interface SeedTemplate {
  id: string;
  /** The template's name on the card; also the new deck's title. */
  title: string;
  description: string;
  category: SeedCategory;
  /** A `POST /api/presentations` body (title, slides, pace, settings). */
  deck: { title: string; pace?: 'presenter' | 'audience'; settings?: Record<string, unknown>; slides: Record<string, unknown>[] };
}

const poll = (question: string, options: string[]) => ({
  type: 'select_answer',
  question,
  options: options.map((text) => ({ text, isCorrect: false })),
  points: 0,
  scoreDependsOnTime: false,
  timeLimit: 30,
});

const quiz = (question: string, options: string[], correct: number, timeLimit = 20) => ({
  type: 'select_answer',
  question,
  options: options.map((text, index) => ({ text, isCorrect: index === correct })),
  points: 1000,
  scoreDependsOnTime: true,
  timeLimit,
});

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  {
    id: 'team-retro',
    title: 'Team retro',
    description:
      'A sprint retrospective in 20 minutes: a mood check, what went well, what slowed the team down, and a vote on what to fix first.',
    category: 'Meetings',
    deck: {
      title: 'Team retro',
      settings: { nickname: 'optional' },
      slides: [
        { type: 'heading', content: { title: 'Sprint retro', subtitle: 'What worked, what did not, and what we change next' } },
        {
          type: 'instructions',
          content: { showQr: true, showCode: true, text: 'Join on your phone. Your name is optional.' },
        },
        {
          type: 'scales',
          question: 'How did this sprint feel?',
          statements: ['Workload', 'Focus time', 'Working together', 'Confidence in what we shipped'],
          minLabel: 'Rough',
          maxLabel: 'Great',
          scaleMax: 5,
          timeLimit: 0,
        },
        { type: 'wordcloud', question: 'One word for this sprint', maxEntries: 1, timeLimit: 0 },
        { type: 'open_ended', question: 'What went well?', timeLimit: 0 },
        { type: 'open_ended', question: 'What slowed us down?', timeLimit: 0 },
        {
          type: 'ranking',
          question: 'Which of these should we fix first?',
          items: ['Flaky tests', 'Unclear priorities', 'Too many meetings', 'Slow code review', 'Release process'],
          timeLimit: 0,
        },
        poll('How confident are you in the plan for next sprint?', ['Very confident', 'Somewhat', 'Not yet']),
        {
          type: 'bullets',
          content: {
            title: 'Action items',
            items: ['One owner and one change for each top issue', 'Check progress at the next retro'],
          },
        },
      ],
    },
  },
  {
    id: 'conference-talk',
    title: 'Conference talk with Q&A',
    description:
      'Open with a warm-up poll, keep the room with a word cloud, and end on audience questions they can upvote. Q&A and reactions are on.',
    category: 'Events',
    deck: {
      title: 'Conference talk',
      settings: {
        nickname: 'optional',
        qna: { enabled: true, moderation: false, anonymousAllowed: true, upvotes: true },
        reactions: { enabled: true },
      },
      slides: [
        { type: 'heading', content: { title: 'Your talk title', subtitle: 'Your name, event and date' } },
        {
          type: 'instructions',
          content: { showQr: true, showCode: true, text: 'Scan to vote, react and ask questions during the talk.' },
        },
        poll('Where are you joining from?', ['This city', 'Elsewhere in the country', 'Another country', 'Online']),
        { type: 'bullets', content: { title: 'Agenda', items: ['The problem', 'What we tried', 'What worked', 'Your questions'] } },
        { type: 'big_number', content: { value: 3, prefix: '', suffix: '', label: 'Ideas to take home today' } },
        { type: 'wordcloud', question: 'What is your biggest challenge with this topic?', maxEntries: 2, timeLimit: 0 },
        { type: 'quote', content: { text: 'Replace this with a quote that frames your argument.', attribution: 'Source' } },
        { type: 'qna', question: 'Ask me anything' },
        {
          type: 'scales',
          question: 'How was this talk?',
          statements: ['Useful', 'Clear', 'Engaging'],
          minLabel: 'Not really',
          maxLabel: 'Very',
          scaleMax: 5,
          timeLimit: 0,
        },
      ],
    },
  },
  {
    id: 'classroom-quiz',
    title: 'Classroom quiz',
    description:
      'A timed, scored quiz on the solar system with a leaderboard halfway and at the end. Swap in your own questions and keep the rhythm.',
    category: 'Education',
    deck: {
      title: 'Science quiz: the solar system',
      settings: { nickname: 'required', quiz: { leaderboard: true, showCorrectOnDevices: true } },
      slides: [
        {
          type: 'heading',
          content: { title: 'Science quiz: the solar system', subtitle: 'Correct answers score points, and faster answers score more' },
        },
        { type: 'instructions', content: { showQr: true, showCode: true, text: 'Join with your first name.' } },
        quiz('Which planet is closest to the Sun?', ['Mercury', 'Venus', 'Earth', 'Mars'], 0),
        quiz('Which planet is known as the Red Planet?', ['Jupiter', 'Mars', 'Saturn', 'Neptune'], 1),
        {
          type: 'type_answer',
          question: 'What is the largest planet in our solar system?',
          acceptedAnswers: ['Jupiter'],
          points: 1000,
          scoreDependsOnTime: true,
          timeLimit: 30,
        },
        { type: 'leaderboard', question: 'Halfway leaderboard', timeLimit: 0 },
        quiz('How long does sunlight take to reach Earth?', ['About 8 seconds', 'About 8 minutes', 'About 8 hours', 'About 8 days'], 1),
        quiz('How many moons does Mars have?', ['None', 'One', 'Two', 'Four'], 2),
        quiz('Which planet has the most visible rings?', ['Uranus', 'Earth', 'Saturn', 'Venus'], 2),
        { type: 'leaderboard', question: 'Final leaderboard', timeLimit: 0 },
      ],
    },
  },
  {
    id: 'all-hands-pulse',
    title: 'All-hands pulse',
    description:
      'An anonymous check-in for a company meeting: mood, priorities, where to invest next, and moderated questions for leadership.',
    category: 'Company',
    deck: {
      title: 'All-hands pulse',
      settings: {
        nickname: 'off',
        qna: { enabled: true, moderation: true, anonymousAllowed: true, upvotes: true },
      },
      slides: [
        { type: 'heading', content: { title: 'All-hands', subtitle: 'Quarterly update and open questions' } },
        {
          type: 'instructions',
          content: { showQr: true, showCode: true, text: 'Answers are anonymous. Questions are reviewed before they go on screen.' },
        },
        {
          type: 'scales',
          question: 'How are you feeling about…',
          statements: ['Where the company is heading', 'Your workload', 'How leadership communicates'],
          minLabel: 'Not good',
          maxLabel: 'Very good',
          scaleMax: 5,
          timeLimit: 0,
        },
        poll('Could you name our top three priorities this quarter?', ['Yes, all three', 'Some of them', 'Not really']),
        {
          type: 'hundred_points',
          question: 'Share 100 points: where should we invest next quarter?',
          config: { items: ['Product quality', 'New features', 'Hiring', 'Tools and infrastructure', 'Customer support'] },
          timeLimit: 0,
        },
        { type: 'wordcloud', question: 'One word for our culture right now', maxEntries: 1, timeLimit: 0 },
        { type: 'open_ended', question: 'What should leadership start, stop or continue doing?', timeLimit: 0 },
        { type: 'qna', question: 'Questions for the leadership team' },
      ],
    },
  },
];

export const findSeedTemplate = (id: string) => SEED_TEMPLATES.find((template) => template.id === id) ?? null;
