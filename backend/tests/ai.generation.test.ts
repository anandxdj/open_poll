import { describe, expect, it, beforeAll } from 'bun:test';
import {
  generatedQuizSchemaForLLM,
  generatedQuizSlideSchemaForLLM,
  generatedQuizSlideSchema,
  generateQuizRequestSchema,
} from '../src/modules/ai/ai.schema';
import { AiService } from '../src/modules/ai/ai.service';

// Access private static method for testing the repair logic directly.
// This is a compile-time only check in TypeScript; at runtime all members are accessible.
const repairQuizSlides = (AiService as unknown as {
  repairQuizSlides: (draft: { title: string; slides: unknown[] }) => {
    title: string;
    slides: unknown[];
  };
}).repairQuizSlides;

describe('AI quiz generation — repair schema validation', () => {
  it('repair schema rejects empty question string', () => {
    const result = generatedQuizSlideSchema.safeParse({
      type: 'select_answer',
      question: '',
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false },
      ],
      acceptedAnswers: [],
      statements: [],
      minLabel: '',
      maxLabel: '',
      items: [],
      timeLimit: 30,
      points: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('repair schema rejects empty option text', () => {
    const result = generatedQuizSlideSchema.safeParse({
      type: 'select_answer',
      question: 'Pick one',
      options: [
        { text: '', isCorrect: true },
        { text: 'B', isCorrect: false },
      ],
      acceptedAnswers: [],
      statements: [],
      minLabel: '',
      maxLabel: '',
      items: [],
      timeLimit: 30,
      points: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid select_answer slide', () => {
    const result = generatedQuizSlideSchemaForLLM.safeParse({
      type: 'select_answer',
      question: 'What is 2+2?',
      options: [
        { text: '4', isCorrect: true },
        { text: '3', isCorrect: false },
      ],
      correctOptionIndex: 0,
      acceptedAnswers: [],
      statements: [],
      minLabel: '',
      maxLabel: '',
      items: [],
      timeLimit: 30,
      points: 1000,
    });
    expect(result.success).toBe(true);
  });

  it('repair logic drops slide with empty question', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'select_answer',
          question: '',
          options: [
            { text: 'A', isCorrect: true },
            { text: 'B', isCorrect: false },
          ],
        },
      ],
    };
    expect(() => repairQuizSlides(draft)).toThrow();
  });
});

describe('AI quiz generation — repair logic', () => {
  it('drops a select_answer slide with no correct answer signal', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'select_answer',
          question: 'Pick one',
          options: [
            { text: 'A', isCorrect: false },
            { text: 'B', isCorrect: false },
          ],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
        {
          type: 'select_answer',
          question: 'Valid question',
          options: [
            { text: 'A', isCorrect: true },
            { text: 'B', isCorrect: false },
          ],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
      ],
    };
    const result = repairQuizSlides(draft);
    expect(result.slides).toHaveLength(1);
    const slide = result.slides[0] as { question: string };
    expect(slide.question).toBe('Valid question');
  });

  it('repairs using correctOptionIndex even when isCorrect flags disagree', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'select_answer',
          question: 'Capital of France?',
          options: [
            { text: 'Paris', isCorrect: false },
            { text: 'London', isCorrect: true },
            { text: 'Berlin', isCorrect: false },
          ],
          correctOptionIndex: 0,
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
      ],
    };
    const result = repairQuizSlides(draft);
    expect(result.slides).toHaveLength(1);
    const slide = result.slides[0] as { options: { text: string; isCorrect: boolean }[] };
    expect(slide.options[0]!.isCorrect).toBe(true);
    expect(slide.options[1]!.isCorrect).toBe(false);
  });

  it('falls back to isCorrect flags when correctOptionIndex is missing', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'select_answer',
          question: 'Pick one',
          options: [
            { text: 'A', isCorrect: false },
            { text: 'B', isCorrect: true },
          ],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
      ],
    };
    const result = repairQuizSlides(draft);
    expect(result.slides).toHaveLength(1);
    const slide = result.slides[0] as { options: { text: string; isCorrect: boolean }[] };
    expect(slide.options[1]!.isCorrect).toBe(true);
    expect(slide.options[0]!.isCorrect).toBe(false);
  });

  it('drops type_answer slide with no acceptedAnswers', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'type_answer',
          question: 'Name a color',
          options: [],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
        {
          type: 'type_answer',
          question: 'Valid answer',
          options: [],
          acceptedAnswers: ['purple'],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
      ],
    };
    const result = repairQuizSlides(draft);
    expect(result.slides).toHaveLength(1);
    const slide = result.slides[0] as { question: string };
    expect(slide.question).toBe('Valid answer');
  });

  it('drops scales slide with no statements', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'scales',
          question: 'Rate this',
          options: [],
          acceptedAnswers: [],
          statements: [],
          minLabel: 'No',
          maxLabel: 'Yes',
          items: [],
          timeLimit: 30,
          points: 0,
        },
        {
          type: 'scales',
          question: 'Valid scales',
          options: [],
          acceptedAnswers: [],
          statements: ['I like this'],
          minLabel: 'No',
          maxLabel: 'Yes',
          items: [],
          timeLimit: 30,
          points: 0,
        },
      ],
    };
    const result = repairQuizSlides(draft);
    expect(result.slides).toHaveLength(1);
    const slide = result.slides[0] as { question: string };
    expect(slide.question).toBe('Valid scales');
  });

  it('drops ranking slide with fewer than 2 items', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'ranking',
          question: 'Rank these',
          options: [],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: ['only one'],
          timeLimit: 30,
          points: 0,
        },
        {
          type: 'ranking',
          question: 'Valid ranking',
          options: [],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: ['A', 'B', 'C'],
          timeLimit: 30,
          points: 0,
        },
      ],
    };
    const result = repairQuizSlides(draft);
    expect(result.slides).toHaveLength(1);
    const slide = result.slides[0] as { question: string };
    expect(slide.question).toBe('Valid ranking');
  });

  it('sets points to 0 for non-scored slide types', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'wordcloud',
          question: 'What words come to mind?',
          options: [],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
      ],
    };
    const result = repairQuizSlides(draft);
    expect(result.slides).toHaveLength(1);
    const slide = result.slides[0] as { points: number };
    expect(slide.points).toBe(0);
  });

  it('throws when all slides are dropped', () => {
    const draft = {
      title: 'Test',
      slides: [
        {
          type: 'select_answer',
          question: 'Pick one',
          options: [
            { text: 'A', isCorrect: false },
            { text: 'B', isCorrect: false },
          ],
          acceptedAnswers: [],
          statements: [],
          minLabel: '',
          maxLabel: '',
          items: [],
          timeLimit: 30,
          points: 1000,
        },
      ],
    };
    expect(() => repairQuizSlides(draft)).toThrow();
  });
});

describe('AI quiz generation — mock fallback (no Gemini key)', () => {
  // Ensure no Gemini key is set so the service falls back to the mock draft
  beforeAll(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('generateQuizDraft returns the requested number of slides via mock', async () => {
    const input = generateQuizRequestSchema.parse({
      topic: 'Space exploration',
      slideCount: 4,
      slideTypes: ['select_answer', 'type_answer'],
      tone: 'educational',
    });
    const result = await AiService.generateQuizDraft(input);
    expect(result.slides).toHaveLength(4);
    // Every slide should pass the strict quizSlideSchema (repair always validates)
    for (const slide of result.slides) {
      expect(slide.type).toBeDefined();
      expect(slide.question.length).toBeGreaterThan(0);
    }
  });

  it('mock select_answer slide has exactly one correct option', async () => {
    const input = generateQuizRequestSchema.parse({
      topic: 'Geography',
      slideCount: 1,
      slideTypes: ['select_answer'],
      tone: 'professional',
    });
    const result = await AiService.generateQuizDraft(input);
    const slide = result.slides[0] as {
      type: string;
      options: { isCorrect: boolean }[];
    };
    expect(slide.type).toBe('select_answer');
    const correctCount = slide.options.filter((o) => o.isCorrect).length;
    expect(correctCount).toBe(1);
  });
});
