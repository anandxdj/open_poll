import { describe, expect, it } from 'bun:test';
import { listSlideTypes } from '../src/modules/presentations/slides';
import { availableKinds, DECK_SLIDE_MAPPERS } from '../src/modules/ai/deck/slideMappers';
import { AGENT_SLIDE_MAPPERS, agentKinds, parseVideoUrl } from '../src/modules/ai/deck/agentMappers';
import {
  AGENT_SLIDE_EXAMPLES,
  agentKindFields,
  agentSlideSchema,
  buildAgentSlide,
  buildAgentSlides,
  type AgentSlide,
} from '../src/modules/ai/deck/agent.schema';

const built = (slide: AgentSlide) => {
  const result = buildAgentSlide(agentSlideSchema.parse(slide));
  if (!result.ok) throw new Error(`${slide.kind} did not validate: ${result.issues.join('; ')}`);
  return result.slide;
};

describe('agent slide kinds', () => {
  it('cover every registered slide type', () => {
    const covered = new Set(agentKinds().map((mapper) => mapper.type));
    for (const def of listSlideTypes()) expect(covered.has(def.type)).toBe(true);
  });

  it('leave the in-app AI kinds unchanged', () => {
    expect(availableKinds().map((mapper) => mapper.kind)).toEqual(DECK_SLIDE_MAPPERS.map((mapper) => mapper.kind));
    for (const mapper of AGENT_SLIDE_MAPPERS) {
      expect(availableKinds().some((offered) => offered.kind === mapper.kind)).toBe(false);
    }
  });

  it('have one schema variant and one example per kind', () => {
    for (const mapper of agentKinds()) {
      expect(AGENT_SLIDE_EXAMPLES[mapper.kind as AgentSlide['kind']]?.kind).toBe(mapper.kind as AgentSlide['kind']);
    }
    expect(Object.keys(AGENT_SLIDE_EXAMPLES).sort()).toEqual(agentKinds().map((mapper) => mapper.kind).sort());
  });

  it('build every example into a valid registry slide', () => {
    for (const example of Object.values(AGENT_SLIDE_EXAMPLES)) {
      const slide = built(example);
      expect(slide.type).toBe(agentKinds().find((mapper) => mapper.kind === example.kind)!.type);
    }
  });

  it('list required and optional fields from the schema', () => {
    expect(agentKindFields('multiple_choice_quiz').required).toEqual(['question', 'options']);
    expect(agentKindFields('grid_2x2').required).toEqual(['question', 'items', 'xAxis', 'yAxis']);
    expect(agentKindFields('qna').required).toEqual([]);
  });
});

describe('agent slide contract', () => {
  it('rejects text over the cap instead of cutting it', () => {
    const result = agentSlideSchema.safeParse({ kind: 'heading', title: 'x'.repeat(151) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['title']);
  });

  it('requires a right answer on a quiz question', () => {
    const result = agentSlideSchema.safeParse({
      kind: 'multiple_choice_quiz',
      question: 'Pick one',
      options: [
        { text: 'A', isCorrect: false },
        { text: 'B', isCorrect: false },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('keeps a poll ungraded and a quiz scored', () => {
    const poll = built({ kind: 'multiple_choice_poll', question: 'Lunch?', options: ['Pizza', 'Sushi'] });
    expect(poll.points).toBe(0);
    expect(poll.options?.every((option) => !option.isCorrect)).toBe(true);
    const quiz = built(AGENT_SLIDE_EXAMPLES.multiple_choice_quiz);
    expect(quiz.points).toBe(1000);
    expect(quiz.options?.[0]).toEqual({ text: 'Mercury', isCorrect: true });
  });

  it('applies timer and points overrides', () => {
    const quiz = built({ ...AGENT_SLIDE_EXAMPLES.multiple_choice_quiz, timeLimit: 20, points: 500 } as AgentSlide);
    expect(quiz.timeLimit).toBe(20);
    expect(quiz.points).toBe(500);
    const cloud = built({ kind: 'wordcloud', question: 'One word?', maxEntries: 1, timeLimit: 0 });
    expect(cloud.maxEntries).toBe(1);
    expect(cloud.timeLimit).toBe(0);
  });

  it('grades guess_number and pin_on_image only with an answer', () => {
    expect(built(AGENT_SLIDE_EXAMPLES.guess_number).points).toBe(1000);
    expect(built({ kind: 'guess_number', question: 'Estimate the crowd', min: 0, max: 500, step: 10 }).points).toBe(0);
    const pin = built(AGENT_SLIDE_EXAMPLES.pin_on_image);
    expect((pin.config as any).region).toEqual({ x: 0.8, y: 0.1, width: 0.15, height: 0.2 });
    expect(built({ ...AGENT_SLIDE_EXAMPLES.pin_on_image, correctArea: undefined } as AgentSlide).points).toBe(0);
  });

  it('reads YouTube and Vimeo addresses', () => {
    expect(parseVideoUrl('https://youtu.be/aqz-KE-bpKQ')).toEqual({ provider: 'youtube', id: 'aqz-KE-bpKQ' });
    expect(parseVideoUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=3')).toEqual({ provider: 'youtube', id: 'aqz-KE-bpKQ' });
    expect(parseVideoUrl('https://vimeo.com/123456789')).toEqual({ provider: 'vimeo', id: '123456789' });
    expect(parseVideoUrl('https://example.com/video.mp4')).toBeNull();
    const video = built(AGENT_SLIDE_EXAMPLES.video);
    expect(video.content).toMatchObject({ provider: 'youtube', id: 'aqz-KE-bpKQ', start: 30 });
  });

  it('rejects a batch with every issue, by position', () => {
    const result = buildAgentSlides(
      [
        AGENT_SLIDE_EXAMPLES.heading,
        { kind: 'guess_number', question: 'Pick', min: 10, max: 5 },
        { kind: 'grid_2x2', question: 'Place', items: ['A'], xAxis: { label: 'X', min: 5, max: 1 }, yAxis: { label: 'Y' } },
      ],
      3,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.startsWith('slides[4] (guess_number)'))).toBe(true);
    expect(result.issues.some((issue) => issue.startsWith('slides[5] (grid_2x2)'))).toBe(true);
  });

  it('reports slides without speaker notes', () => {
    const result = buildAgentSlides([AGENT_SLIDE_EXAMPLES.heading, { ...AGENT_SLIDE_EXAMPLES.wordcloud, notes: 'Read a few out' } as AgentSlide]);
    expect(result.ok && result.withoutNotes).toEqual([0]);
  });
});
