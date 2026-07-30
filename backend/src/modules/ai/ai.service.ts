import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import { QUIZ_SLIDE_TYPES, quizSlideSchema } from '../quizzes/quizzes.schema';
import {
  generatedPollSchema,
  generatedTrialSchema,
  generatedQuizSchemaForLLM,
} from './ai.schema';
import type {
  GenerateAndSavePollRequestInput,
  GeneratedPollOutput,
  GeneratedQuizDraftOutput,
  GeneratePollRequestInput,
  GenerateQuizRequestInput,
} from './ai.schema';

type AiProviderCandidate = {
  name: string;
  model: BaseChatModel;
  /** Forced structured-output strategy; omit to let LangChain pick per model. */
  structuredMethod?: 'functionCalling' | 'jsonMode' | 'jsonSchema';
};

type AiGraphState = {
  topic: string;
  tone: GeneratePollRequestInput['tone'];
  questionCount: number;
  generated?: GeneratedPollOutput;
};

export class AiService {
  /** Env placeholders that ship in .env.example — treat them as "unset". */
  private static isPlaceholder(value: string | undefined): boolean {
    if (!value || !value.trim()) return true;
    return /^(your_|dummy_|changeme)/i.test(value.trim());
  }

  /**
   * Providers in preference order: an OpenAI-compatible endpoint (LLM_BASE_URL +
   * LLM_API_KEY, e.g. the Open Quota proxy) first, then Gemini directly. Empty
   * means no credentials are configured and callers fall back to a mock draft.
   */
  private static getModelCandidates(): AiProviderCandidate[] {
    const candidates: AiProviderCandidate[] = [];

    const proxyKey = process.env.LLM_API_KEY;
    const proxyBaseUrl = process.env.LLM_BASE_URL;
    if (!this.isPlaceholder(proxyKey) && !this.isPlaceholder(proxyBaseUrl)) {
      candidates.push({
        name: 'openai-compatible',
        // Behind a router the served model is not guaranteed to honour
        // response_format: json_schema — several free-tier models reply with
        // ```-fenced JSON, which fails to parse. Tool calls are honoured.
        structuredMethod: 'functionCalling',
        model: new ChatOpenAI({
          // Pinned to a fast, tool-calling model. "auto" lets the proxy's router
          // choose instead, but it can land on a slow reasoning model.
          // See GET <LLM_BASE_URL>/models for available ids.
          model: process.env.LLM_MODEL || 'gemini-2.5-flash-lite',
          temperature: 0.3,
          apiKey: proxyKey,
          configuration: { baseURL: proxyBaseUrl },
          // Free-tier routes can be slow or rate-limited; cap the wait so we fail
          // over to the next provider instead of hanging the HTTP request.
          timeout: Number(process.env.LLM_TIMEOUT_MS) || 60_000,
          maxRetries: 1,
        }),
      });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!this.isPlaceholder(geminiKey)) {
      candidates.push({
        name: 'gemini',
        model: new ChatGoogleGenerativeAI({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          temperature: 0.3,
          apiKey: geminiKey,
          // LangChain retries 6 times with exponential backoff by default, so a
          // free-tier quota 429 turns a 2s call into minutes of silent waiting.
          maxRetries: 1,
        }),
      });
    }

    if (candidates.length === 0) {
      console.warn(
        '[AiService] No LLM_BASE_URL/LLM_API_KEY and no GEMINI_API_KEY — using mock draft fallback.'
      );
    }

    return candidates;
  }

  private static hasModel(): boolean {
    return this.getModelCandidates().length > 0;
  }

  /**
   * Runs a structured-output prompt against each configured provider in order, so a
   * rate-limited or unhealthy proxy degrades to the next provider instead of a mock.
   * Throws the last error if every provider fails.
   */
  private static async invokeStructured<T>(schema: z.ZodType<T>, prompt: string): Promise<T> {
    const candidates = this.getModelCandidates();
    if (candidates.length === 0) {
      throw ApiError.badRequest('No AI provider configured');
    }

    let lastError: unknown;
    for (const { name, model, structuredMethod } of candidates) {
      const startedAt = Date.now();
      try {
        const structured = structuredMethod
          ? model.withStructuredOutput(schema, { method: structuredMethod })
          : model.withStructuredOutput(schema);
        const result = (await structured.invoke(prompt)) as T;
        console.log(`[AiService] provider "${name}" ok in ${Date.now() - startedAt}ms`);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`[AiService] provider "${name}" failed after ${Date.now() - startedAt}ms`, error);
      }
    }
    throw lastError;
  }

  private static buildMockDraft(input: GeneratePollRequestInput): GeneratedPollOutput {
    const isTrial = input.pollType === 'TRIAL';
    return generatedPollSchema.parse({
      title: `AI Mock ${isTrial ? 'Trial' : 'Poll'}: ${input.topic.trim().slice(0, 50)}`,
      pollType: input.pollType || 'POLL',
      passingScorePercentage: input.passingScorePercentage || 70,
      isAnonymous: input.isAnonymous,
      expiresAt: input.expiresAt,
      isPublished: false,
      questions: isTrial
        ? [
            {
              text: `What is the primary concept behind ${input.topic}?`,
              options: ['Core Concept A', 'Concept B', 'Irrelevant Option'],
              type: 'single',
              correctOptionIndices: [0],
              explanation: 'Core Concept A is the primary concept.',
              points: 1,
              isMandatory: true,
            },
            {
              text: `Select all key characteristics of ${input.topic}:`,
              options: ['Characteristic 1', 'Characteristic 2', 'Incorrect Feature'],
              type: 'multiple',
              correctOptionIndices: [0, 1],
              explanation: 'Characteristics 1 and 2 are true features.',
              points: 1,
              isMandatory: true,
            },
          ]
        : [
            {
              text: 'How clear is this poll topic?',
              options: ['Very clear', 'Somewhat clear', 'Not clear'],
              type: 'single',
              correctOptionIndices: [],
              explanation: '',
              points: 1,
              isMandatory: true,
            },
            {
              text: 'How interested are you in participating further?',
              options: ['Very interested', 'Maybe later', 'Not interested'],
              type: 'single',
              correctOptionIndices: [],
              explanation: '',
              points: 1,
              isMandatory: true,
            },
          ],
    });
  }

  private static async generateWithGraph(input: GeneratePollRequestInput): Promise<GeneratedPollOutput> {
    if (!this.hasModel()) {
      return this.buildMockDraft(input);
    }
    const isTrial = input.pollType === 'TRIAL';

    // A TRIAL is generated against a schema that REQUIRES correctOptionIndices, so
    // the model cannot return an assessment nobody could score.
    const outputSchema = isTrial ? generatedTrialSchema : generatedPollSchema;

    const graph = new StateGraph<AiGraphState>({
      channels: {
        topic: { value: (left) => left, default: () => input.topic },
        tone: { value: (left) => left, default: () => input.tone },
        questionCount: { value: (left) => left, default: () => input.questionCount },
        generated: { value: (left) => left, default: () => undefined },
      },
    })
      .addNode('generatePoll', async () => {
        const systemPrompt = isTrial
          ? [
              `You are an expert Educator and Assessment Designer.`,
              `Create a highly engaging, ${input.tone} test/assessment TRIAL payload based on the following topic:`,
              `"${input.topic}"`,
              ``,
              `CRITICAL RULES FOR TRIAL:`,
              `- You MUST generate EXACTLY ${input.questionCount} questions.`,
              `- Set pollType to "TRIAL" and passingScorePercentage to ${input.passingScorePercentage || 70}.`,
              `- For each question, specify type as either "single" or "multiple".`,
              `- Provide correctOptionIndices (array of 0-based option index numbers that are correct).`,
              `- Provide a clear explanation for why the answer is correct.`,
              `- Ensure each question has between 2 and 4 options.`,
              `- Maintain a ${input.tone} tone strictly throughout.`,
            ].join('\n')
          : [
              `You are an expert UX Researcher and Survey Designer.`,
              `Create a highly engaging, ${input.tone} polling payload based on the following topic:`,
              `"${input.topic}"`,
              ``,
              `CRITICAL RULES:`,
              `- You MUST generate EXACTLY ${input.questionCount} questions. No more, no less.`,
              `- Set pollType to "POLL".`,
              `- All questions must be single-option multiple choice.`,
              `- Each question must have between 2 and 4 engaging options.`,
              `- Maintain a ${input.tone} tone strictly throughout.`,
            ].join('\n');

        const generated = await this.invokeStructured(outputSchema, systemPrompt);

        return {
          generated: {
            ...generated,
            pollType: input.pollType || 'POLL',
            passingScorePercentage: input.passingScorePercentage || 70,
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
        throw ApiError.badRequest('AI could not generate a valid payload');
      }

      return outputSchema.parse(result.generated);
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

  // ---------- Quiz AI Service Methods ----------

  private static repairQuizSlides(
    draft: { title?: string; slides?: unknown[] },
    input?: GenerateQuizRequestInput
  ): GeneratedQuizDraftOutput {
    const rawSlides = Array.isArray(draft?.slides) ? draft.slides : [];
    const repairedSlides: z.infer<typeof quizSlideSchema>[] = [];

    for (const rawItem of rawSlides) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const raw = { ...(rawItem as Record<string, any>) };

      if (!QUIZ_SLIDE_TYPES.includes(raw.type)) continue;
      const type = raw.type;

      if (typeof raw.question !== 'string' || !raw.question.trim()) continue;
      const question = raw.question.trim();

      // Normalize options (support string array or object array)
      let options: { text: string; isCorrect: boolean }[] = [];
      if (Array.isArray(raw.options)) {
        options = raw.options.map((opt: any, idx: number) => {
          if (typeof opt === 'string') {
            return { text: opt, isCorrect: false };
          }
          return {
            text: typeof opt?.text === 'string' ? opt.text : '',
            isCorrect: Boolean(opt?.isCorrect),
          };
        });
      }

      if (type === 'select_answer') {
        if (options.length < 2) continue;
        let correctIdx = -1;
        if (typeof raw.correctOptionIndex === 'number' && raw.correctOptionIndex >= 0 && raw.correctOptionIndex < options.length) {
          correctIdx = raw.correctOptionIndex;
        } else {
          correctIdx = options.findIndex((o) => o.isCorrect);
        }

        if (correctIdx === -1) continue; // Drop if no correct answer signal

        options = options.map((opt, i) => ({
          text: opt.text,
          isCorrect: i === correctIdx,
        }));
      }

      // Normalize acceptedAnswers
      let acceptedAnswers: string[] = [];
      if (Array.isArray(raw.acceptedAnswers)) {
        acceptedAnswers = raw.acceptedAnswers.map((a: any) => String(a).trim()).filter(Boolean);
      } else if (typeof raw.acceptedAnswers === 'string' && raw.acceptedAnswers.trim()) {
        acceptedAnswers = [raw.acceptedAnswers.trim()];
      }
      if (type === 'type_answer' && acceptedAnswers.length === 0) continue;

      // Normalize statements
      let statements: string[] = [];
      if (Array.isArray(raw.statements)) {
        statements = raw.statements.map((s: any) => String(s).trim()).filter(Boolean);
      } else if (typeof raw.statements === 'string' && raw.statements.trim()) {
        statements = [raw.statements.trim()];
      }
      if (type === 'scales' && statements.length === 0) continue;

      // Normalize items
      let items: string[] = [];
      if (Array.isArray(raw.items)) {
        items = raw.items.map((i: any) => String(i).trim()).filter(Boolean);
      }
      if (type === 'ranking' && items.length < 2) continue;

      const nonScoredTypes = ['wordcloud', 'open_ended', 'scales', 'ranking'];
      const points = nonScoredTypes.includes(type) ? 0 : (typeof raw.points === 'number' ? raw.points : 1000);
      const timeLimit = typeof raw.timeLimit === 'number' && raw.timeLimit >= 5 && raw.timeLimit <= 300 ? raw.timeLimit : 30;

      const candidate = {
        type,
        question,
        options,
        acceptedAnswers,
        statements,
        minLabel: typeof raw.minLabel === 'string' ? raw.minLabel : '',
        maxLabel: typeof raw.maxLabel === 'string' ? raw.maxLabel : '',
        scaleMax: typeof raw.scaleMax === 'number' ? raw.scaleMax : 5,
        items,
        maxEntries: 3,
        timeLimit,
        points,
        scoreDependsOnTime: true,
      };

      const finalParse = quizSlideSchema.safeParse(candidate);
      if (finalParse.success) {
        repairedSlides.push(finalParse.data);
      }
    }

    if (repairedSlides.length === 0) {
      if (input) {
        return this.buildMockQuizDraft(input);
      }
      throw ApiError.badRequest('All generated slides failed schema validation');
    }

    return {
      title: typeof draft?.title === 'string' && draft.title.trim() ? draft.title.trim() : (input ? `Quiz: ${input.topic}` : 'AI Generated Quiz'),
      slides: repairedSlides,
    };
  }

  private static buildMockQuizDraft(input: GenerateQuizRequestInput): GeneratedQuizDraftOutput {
    const types = input.slideTypes.length > 0 ? input.slideTypes : ['select_answer', 'type_answer'];
    const slides: z.infer<typeof quizSlideSchema>[] = [];

    for (let i = 0; i < input.slideCount; i++) {
      const type = types[i % types.length]!;
      if (type === 'select_answer') {
        slides.push(
          quizSlideSchema.parse({
            type: 'select_answer',
            question: `Question ${i + 1}: What is a fundamental aspect of ${input.topic}?`,
            options: [
              { text: 'Primary concept', isCorrect: true },
              { text: 'Alternative concept', isCorrect: false },
              { text: 'Secondary detail', isCorrect: false },
            ],
            timeLimit: 30,
            points: 1000,
          })
        );
      } else if (type === 'type_answer') {
        slides.push(
          quizSlideSchema.parse({
            type: 'type_answer',
            question: `Question ${i + 1}: What key term relates to ${input.topic}?`,
            acceptedAnswers: [input.topic.trim().split(' ')[0] || 'core'],
            timeLimit: 30,
            points: 1000,
          })
        );
      } else if (type === 'wordcloud') {
        slides.push(
          quizSlideSchema.parse({
            type: 'wordcloud',
            question: `Question ${i + 1}: What words come to mind for ${input.topic}?`,
            points: 0,
            timeLimit: 30,
          })
        );
      } else if (type === 'open_ended') {
        slides.push(
          quizSlideSchema.parse({
            type: 'open_ended',
            question: `Question ${i + 1}: Describe your experience with ${input.topic}.`,
            points: 0,
            timeLimit: 30,
          })
        );
      } else if (type === 'scales') {
        slides.push(
          quizSlideSchema.parse({
            type: 'scales',
            question: `Question ${i + 1}: Rate the following statements about ${input.topic}:`,
            statements: [`I am knowledgeable about ${input.topic}`, `I find ${input.topic} engaging`],
            minLabel: 'Strongly Disagree',
            maxLabel: 'Strongly Agree',
            points: 0,
            timeLimit: 30,
          })
        );
      } else if (type === 'ranking') {
        slides.push(
          quizSlideSchema.parse({
            type: 'ranking',
            question: `Question ${i + 1}: Rank these elements of ${input.topic} by priority:`,
            items: ['Core Principles', 'Practical Application', 'Advanced Topics'],
            points: 0,
            timeLimit: 30,
          })
        );
      }
    }

    return {
      title: `Quiz: ${input.topic.trim().slice(0, 50)}`,
      slides,
    };
  }

  static async generateQuizDraft(input: GenerateQuizRequestInput): Promise<GeneratedQuizDraftOutput> {
    if (!this.hasModel()) {
      return this.buildMockQuizDraft(input);
    }

    try {
      const systemPrompt = [
        `You are an expert Quiz Master and Assessment Designer.`,
        `Create an engaging ${input.tone} interactive quiz payload for topic: "${input.topic}".`,
        ``,
        `RULES:`,
        `- Generate EXACTLY ${input.slideCount} slides.`,
        `- Use ONLY the following slide types: ${input.slideTypes.join(', ')}.`,
        `- For select_answer: provide 2-4 options, set correctOptionIndex (0-based) and set isCorrect: true on that option.`,
        `- For type_answer: provide at least 1 answer in acceptedAnswers.`,
        `- For scales: provide at least 1 statement in statements, set minLabel and maxLabel.`,
        `- For ranking: provide at least 2 items in items.`,
        `- For wordcloud or open_ended: provide a clear question.`,
      ].join('\n');

      const result = await this.invokeStructured(generatedQuizSchemaForLLM, systemPrompt);
      return this.repairQuizSlides(result, input);
    } catch (err) {
      console.error('[AI Quiz Generation Error]', err);
      return this.buildMockQuizDraft(input);
    }
  }
}
