import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph } from '@langchain/langgraph';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import {
  generatedPollSchema,
  generatedQuizSchema,
  generatedQuizSchemaForLLM,
} from './ai.schema';
import type {
  GeneratedPollOutput,
  GenerateAndSavePollRequestInput,
  GeneratePollRequestInput,
  GeneratedQuizOutput,
  GenerateQuizRequestInput,
} from './ai.schema';
import { quizSlideSchema } from '../quizzes/quizzes.schema';

type AiGraphState = {
  topic: string;
  tone: GeneratePollRequestInput['tone'];
  questionCount: number;
  generated?: GeneratedPollOutput;
};

export class AiService {
  private static getModel() {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      return null;
    }

    return new ChatGoogleGenerativeAI({
      model: 'gemini-flash-lite-latest',
      temperature: 0.3,
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  private static buildMockDraft(input: GeneratePollRequestInput): GeneratedPollOutput {
    return generatedPollSchema.parse({
      title: `AI Mock Poll: ${input.topic.trim().slice(0, 50)}`,
      isAnonymous: input.isAnonymous,
      expiresAt: input.expiresAt,
      isPublished: false,
      questions: [
        {
          text: 'How clear is this poll topic?',
          options: ['Very clear', 'Somewhat clear', 'Not clear'],
          isMandatory: true,
        },
        {
          text: 'How interested are you in participating further?',
          options: ['Very interested', 'Maybe later', 'Not interested'],
          isMandatory: true,
        },
      ],
    });
  }

  private static async generateWithGraph(input: GeneratePollRequestInput): Promise<GeneratedPollOutput> {
    const model = this.getModel();
    if (!model) {
      return this.buildMockDraft(input);
    }
    const structuredModel = model.withStructuredOutput(generatedPollSchema);

    const graph = new StateGraph<AiGraphState>({
      channels: {
        topic: { value: (left) => left, default: () => input.topic },
        tone: { value: (left) => left, default: () => input.tone },
        questionCount: { value: (left) => left, default: () => input.questionCount },
        generated: { value: (left) => left, default: () => undefined },
      },
    })
      .addNode('generatePoll', async () => {
        const systemPrompt = [
          `You are an expert UX Researcher and Survey Designer.`,
          `Create a highly engaging, ${input.tone} polling payload based on the following topic or context:`,
          `"${input.topic}"`,
          ``,
          `CRITICAL RULES:`,
          `- You MUST generate EXACTLY ${input.questionCount} questions. No more, no less.`,
          `- All questions must be single-option multiple choice.`,
          `- Each question must have between 2 and 4 engaging options.`,
          `- Maintain a ${input.tone} tone strictly throughout the questions and options.`,
          `- Ensure JSON keys match our strict Zod schema perfectly.`,
        ].join('\n');

        const generated = await structuredModel.invoke(systemPrompt);

        return {
          generated: {
            ...generated,
            isAnonymous: input.isAnonymous,
            expiresAt: input.expiresAt,
            isPublished: false,
          },
        };
      })
      .addEdge('__start__', 'generatePoll')
      .addEdge('generatePoll', '__end__');

    try {
      const compiled = graph.compile();
      const result = await compiled.invoke({
        topic: input.topic,
        tone: input.tone,
        questionCount: input.questionCount,
      });

      if (!result.generated) {
        throw ApiError.badRequest('AI could not generate a valid poll');
      }

      return generatedPollSchema.parse(result.generated);
    } catch (error) {
      console.error('[AI Generation Error]', error);
      return this.buildMockDraft(input);
    }
  }

  static async generatePollDraft(input: GeneratePollRequestInput) {
    return this.generateWithGraph(input);
  }

  static async generateAndSavePoll(input: GenerateAndSavePollRequestInput) {
    const draft = await this.generateWithGraph(input);
    const poll = await PollService.createPoll(draft, input.creatorId);
    return { draft, poll };
  }

  // ---------- Quiz generation ----------

  private static buildMockQuizDraft(input: GenerateQuizRequestInput): GeneratedQuizOutput {
    const topic = input.topic.trim().slice(0, 80);
    const slideForType = (type: string): GeneratedQuizOutput['slides'][number] => {
      const base = {
        question: '',
        options: [] as { text: string; isCorrect: boolean }[],
        acceptedAnswers: [] as string[],
        statements: [] as string[],
        minLabel: '',
        maxLabel: '',
        items: [] as string[],
        timeLimit: 30,
        points: 1000,
      };
      switch (type) {
        case 'type_answer':
          return {
            ...base,
            type: 'type_answer',
            question: `In one word, what is most associated with ${topic}?`,
            acceptedAnswers: ['answer'],
          };
        case 'wordcloud':
          return {
            ...base,
            type: 'wordcloud',
            question: `Which words come to mind when you think of ${topic}?`,
            points: 0,
          };
        case 'open_ended':
          return {
            ...base,
            type: 'open_ended',
            question: `What is your honest take on ${topic}?`,
            points: 0,
            timeLimit: 60,
          };
        case 'scales':
          return {
            ...base,
            type: 'scales',
            question: `How do you feel about ${topic}?`,
            statements: [`${topic} matters to me`, `I know a lot about ${topic}`],
            minLabel: 'Disagree',
            maxLabel: 'Agree',
            points: 0,
          };
        case 'ranking':
          return {
            ...base,
            type: 'ranking',
            question: `Rank these aspects of ${topic}`,
            items: ['Quality', 'Speed', 'Cost', 'Fun'],
            points: 0,
          };
        default:
          return {
            ...base,
            type: 'select_answer',
            question: `Which statement about ${topic} is true?`,
            options: [
              { text: 'Option A (correct)', isCorrect: true },
              { text: 'Option B', isCorrect: false },
              { text: 'Option C', isCorrect: false },
            ],
          };
      }
    };

    const slides = Array.from({ length: input.slideCount }, (_, i) =>
      slideForType(input.slideTypes[i % input.slideTypes.length]!)
    );
    return generatedQuizSchema.parse({ title: `AI Mock Quiz: ${topic}`, slides });
  }

  /**
   * Coerce LLM output into slides that pass the strict quiz create contract.
   * Slides that can't be repaired are dropped; throws if nothing survives.
   */
  private static repairQuizSlides(draft: GeneratedQuizOutput) {
    const repaired = draft.slides.flatMap((slide) => {
      const candidate: Record<string, unknown> = { ...slide, scoreDependsOnTime: true };

      if (slide.type === 'select_answer') {
        if (slide.options.length < 2) return [];
        if (!slide.options.some((o) => o.isCorrect)) {
          candidate.options = slide.options.map((o, i) => ({ ...o, isCorrect: i === 0 }));
        }
      }
      if (slide.type === 'type_answer' && slide.acceptedAnswers.length === 0) return [];
      if (slide.type === 'scales' && slide.statements.length === 0) return [];
      if (slide.type === 'ranking' && slide.items.length < 2) return [];
      // Interactive slides carry no points
      if (!['select_answer', 'type_answer'].includes(slide.type)) candidate.points = 0;

      const parsed = quizSlideSchema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    });

    if (repaired.length === 0) {
      throw ApiError.badRequest('AI could not generate any valid quiz slides');
    }
    return { title: draft.title, slides: repaired };
  }

  static async generateQuizDraft(input: GenerateQuizRequestInput) {
    const model = this.getModel();
    if (!model) {
      return this.repairQuizSlides(this.buildMockQuizDraft(input));
    }

    const typeGuidance: Record<string, string> = {
      select_answer:
        'select_answer: scored multiple choice. 3-4 options, EXACTLY one with isCorrect=true.',
      type_answer:
        'type_answer: scored free-text. Provide 1-5 short acceptedAnswers (synonyms/spellings).',
      wordcloud:
        'wordcloud: non-scored. Ask for words/associations. No options/answers needed.',
      open_ended:
        'open_ended: non-scored opinion question. No options/answers needed. timeLimit 45-90s.',
      scales:
        'scales: non-scored. Provide 2-5 statements rated 1-5, plus minLabel (e.g. "Disagree") and maxLabel (e.g. "Agree").',
      ranking:
        'ranking: non-scored. Provide 3-6 items for participants to order.',
    };

    const systemPrompt = [
      `You are an expert quiz master designing a live, Mentimeter-style quiz.`,
      `Create an engaging, ${input.tone} quiz about: "${input.topic}"`,
      ``,
      `CRITICAL RULES:`,
      `- Generate EXACTLY ${input.slideCount} slides. No more, no less.`,
      `- Use ONLY these slide types: ${input.slideTypes.join(', ')}. Mix them across the deck.`,
      `- Type requirements:`,
      ...input.slideTypes.map((t) => `  - ${typeGuidance[t]}`),
      `- Set unused per-type fields to empty arrays/strings.`,
      `- Scored slides: timeLimit 15-45s, points 1000. Non-scored slides: points 0.`,
      `- Keep questions concise (under 200 chars) and fun to answer on a phone.`,
    ].join('\n');

    try {
      const structuredModel = model.withStructuredOutput(generatedQuizSchemaForLLM);
      const generated = await structuredModel.invoke(systemPrompt);
      return this.repairQuizSlides(generatedQuizSchema.parse(generated));
    } catch (error) {
      console.error('[AI Quiz Generation Error]', error);
      return this.repairQuizSlides(this.buildMockQuizDraft(input));
    }
  }
}
