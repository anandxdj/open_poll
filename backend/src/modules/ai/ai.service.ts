import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph } from '@langchain/langgraph';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import {
  generatedPollSchema,
} from './ai.schema';
import type { GeneratedPollOutput, GenerateAndSavePollRequestInput, GeneratePollRequestInput } from './ai.schema';

type AiGraphState = {
  prompt: string;
  generated?: GeneratedPollOutput;
};

export class AiService {
  private static getModel() {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      throw ApiError.badRequest('GEMINI_API_KEY is missing or invalid');
    }

    return new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: 0.3,
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  private static async generateWithGraph(input: GeneratePollRequestInput): Promise<GeneratedPollOutput> {
    const model = this.getModel().withStructuredOutput(generatedPollSchema);

    const graph = new StateGraph<AiGraphState>({
      channels: {
        prompt: { value: (left) => left, default: () => input.prompt },
        generated: { value: (left) => left, default: () => undefined },
      },
    })
      .addNode('generatePoll', async (state) => {
        const generated = await model.invoke(
          [
            'Generate a polling payload from user instructions.',
            'Rules:',
            '- Only single-option multiple choice questions.',
            '- Each question must have at least 2 options.',
            '- Keep language concise and production-ready.',
            `Prompt: ${state.prompt}`,
          ].join('\n'),
        );

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

    const compiled = graph.compile();
    const result = await compiled.invoke({ prompt: input.prompt });

    if (!result.generated) {
      throw ApiError.badRequest('AI could not generate a valid poll');
    }

    return generatedPollSchema.parse(result.generated);
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
