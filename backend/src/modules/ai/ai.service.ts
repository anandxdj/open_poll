import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph } from '@langchain/langgraph';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import {
  generatedPollSchema,
} from './ai.schema';
import type { GeneratedPollOutput, GenerateAndSavePollRequestInput, GeneratePollRequestInput } from './ai.schema';

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
      model: 'gemini-flash-latest',
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
}
