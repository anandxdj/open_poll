import type { DeckOutline, GeneratedSlide, GenerateDeckInput } from './deck.schema';
import type { DeckSlideMapper } from './slideMappers';
import type { PositionedSlide } from './prompts';

/**
 * Mock mode (no AI provider configured): a deterministic outline and placeholder
 * slides built from the topic. They run through the same mappers and registry
 * validation as generated slides, and the response says `source: 'mock'`, so
 * nothing here can pass for model output. The notes say so too.
 */

const SECTION_TITLES = ['Introduction', 'Core ideas', 'Going deeper', 'Wrap-up'];

/** Rotation order per category; the first available kind of each comes first. */
const ROTATION: Record<DeckSlideMapper['category'], string[]> = {
  content: ['paragraph', 'bullets', 'big_number', 'quote'],
  poll: ['multiple_choice_poll', 'wordcloud', 'scales', 'open_ended', 'ranking'],
  quiz: ['multiple_choice_quiz', 'type_answer'],
};

const shortTopic = (topic: string) => (topic.length > 60 ? `${topic.slice(0, 59).trimEnd()}…` : topic);

const INTENTS: Record<string, (topic: string, n: number) => string> = {
  heading: (t) => `Introduce ${t}`,
  paragraph: (t, n) => `Explain key idea ${n} of ${t}`,
  bullets: (t, n) => `List the main points of part ${n} of ${t}`,
  big_number: (t) => `Show one figure that matters for ${t}`,
  quote: (t) => `A statement that sums up ${t}`,
  multiple_choice_poll: (t) => `Ask how familiar the audience is with ${t}`,
  wordcloud: (t) => `Collect the words the audience links to ${t}`,
  scales: (t) => `Let the audience rate statements about ${t}`,
  open_ended: (t) => `Ask what the audience wants to learn about ${t}`,
  ranking: (t) => `Let the audience rank what matters most in ${t}`,
  multiple_choice_quiz: (t, n) => `Quiz question ${n} on ${t}`,
  type_answer: (t, n) => `Short-answer question ${n} on ${t}`,
};

/** Outline with `slideCount` slides, cycling through the enabled categories. */
export function buildMockOutline(input: Pick<GenerateDeckInput, 'topic' | 'slideCount' | 'title'>, mappers: readonly DeckSlideMapper[]): DeckOutline {
  const topic = shortTopic(input.topic);
  const kinds = new Set(mappers.map((mapper) => mapper.kind));
  const rotations = (['content', 'poll', 'quiz'] as const)
    .map((category) => ROTATION[category].filter((kind) => kinds.has(kind)))
    .filter((list) => list.length > 0);
  const cursor = rotations.map(() => 0);
  const counts = new Map<string, number>();

  const slides: { type: string; intent: string }[] = [];
  const push = (type: string) => {
    const n = (counts.get(type) ?? 0) + 1;
    counts.set(type, n);
    slides.push({ type, intent: INTENTS[type]!(topic, n) });
  };
  if (kinds.has('heading')) push('heading');
  for (let turn = 0; slides.length < input.slideCount; turn++) {
    const group = turn % rotations.length;
    const list = rotations[group]!;
    push(list[cursor[group]! % list.length]!);
    cursor[group]! += 1;
  }

  // Sections as even as possible; the first ones take the remainder.
  const sectionCount = Math.min(SECTION_TITLES.length, Math.max(1, Math.ceil(slides.length / 3)));
  const base = Math.floor(slides.length / sectionCount);
  const extra = slides.length % sectionCount;
  let start = 0;
  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const size = base + (i < extra ? 1 : 0);
    const section = {
      title: SECTION_TITLES[i === sectionCount - 1 && sectionCount > 1 ? SECTION_TITLES.length - 1 : i]!,
      slides: slides.slice(start, start + size),
    };
    start += size;
    return section;
  }).filter((section) => section.slides.length > 0);

  return { title: input.title ?? `${topic}: an interactive overview`.slice(0, 120), sections };
}

const MOCK_NOTE = 'Placeholder notes (mock mode: no AI key is configured).';

/** A placeholder slide for one outline position; valid for every built-in kind. */
export function buildMockSlide(slide: PositionedSlide, topicInput: string): GeneratedSlide {
  const topic = shortTopic(topicInput);
  const notes = `${MOCK_NOTE} Talk the audience through: ${slide.intent}.`;
  switch (slide.type) {
    case 'heading':
      return { title: topic, subtitle: 'An interactive session', notes };
    case 'paragraph':
      return {
        title: slide.intent,
        body: `This is placeholder text about ${topic}. Replace it with your own explanation before presenting.`,
        notes,
      };
    case 'bullets':
      return { title: slide.intent, items: ['First key point', 'Second key point', 'Third key point'], notes };
    case 'big_number':
      return { value: 3, label: `key ideas about ${topic} in this deck`, notes };
    case 'quote':
      return { text: `Placeholder quotation about ${topic}.`, attribution: 'Replace with a real source', notes };
    case 'multiple_choice_poll':
      return {
        question: `How familiar are you with ${topic}?`,
        options: [
          { text: 'Very familiar', isCorrect: false },
          { text: 'Somewhat familiar', isCorrect: false },
          { text: 'New to me', isCorrect: false },
        ],
        notes,
      };
    case 'wordcloud':
      return { question: `Which word comes to mind for ${topic}?`, notes };
    case 'scales':
      return {
        question: `How do you feel about ${topic}?`,
        statements: [`I understand the basics of ${topic}`, `${topic} matters for my work`],
        minLabel: 'Disagree',
        maxLabel: 'Agree',
        notes,
      };
    case 'open_ended':
      return { question: `What would you like to learn about ${topic}?`, notes };
    case 'ranking':
      return { question: `Rank these parts of ${topic} by importance`, items: ['Basics', 'Practice', 'Advanced topics'], notes };
    case 'multiple_choice_quiz':
      return {
        question: `Placeholder quiz question on ${topic}: which option is marked correct?`,
        options: [
          { text: 'Option A (correct)', isCorrect: true },
          { text: 'Option B', isCorrect: false },
          { text: 'Option C', isCorrect: false },
        ],
        explanation: 'Placeholder: replace with the real answer and why it is right.',
        notes,
      };
    case 'type_answer':
      return { question: `Placeholder question on ${topic}: type "answer"`, acceptedAnswers: ['answer'], notes };
    default:
      return { title: slide.intent, notes };
  }
}
