import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';
import { hincrby, hsetnx, normalizeText, rejectAnswer } from '../ops';
import type { RedisOp } from '../types';

interface WordcloudConfig {
  maxEntries: number;
}

const answerSchema = z.object({
  entries: z.array(z.string().max(60)).max(3).optional(),
  text: z.string().max(500).optional(),
});

const label = questionLabel('Word cloud');

const entriesOf = (payload: unknown): string[] => {
  const entries = (payload as { entries?: unknown } | null)?.entries;
  return Array.isArray(entries) ? entries.map(String) : [];
};

/** Up to `maxEntries` short words per participant, one submission; never scored. */
export const wordcloudSlide = defineSlideType<WordcloudConfig, z.infer<typeof answerSchema>>({
  type: 'wordcloud',
  name: 'Word cloud',
  kind: 'interactive',
  lifecycle: 'response',
  scored: false,
  schema: builtInSlideSchema('wordcloud'),
  sanitize: builtInParticipantFields,
  acceptConfig: (slide) => ({ maxEntries: slide.maxEntries ?? 3 }),
  answerSchema,
  accept: (cfg, { entries, text }) => {
    const raw = entries ?? (text !== undefined ? [text] : []);
    const seen = new Set<string>();
    const distOps: RedisOp[] = [];
    const dispOps: RedisOp[] = [];
    // Capped before dedupe: a duplicate still uses up one of the entries.
    for (const entry of raw.slice(0, cfg.maxEntries)) {
      const normalized = normalizeText(entry);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      distOps.push(hincrby('dist', normalized));
      dispOps.push(hsetnx('disp', normalized, entry.trim()));
    }
    if (distOps.length === 0) rejectAnswer('Submit at least one word');
    return {
      isCorrect: false,
      ops: [...distOps, ...dispOps],
      persist: { optionIndex: null, text: null, payload: { entries: entries ?? (text ? [text] : []) } },
    };
  },
  distribution: (_slide, { dist, disp }) => ({
    kind: 'words',
    words: Object.entries(dist)
      .map(([norm, count]) => ({ text: disp[norm] ?? norm, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100),
  }),
  exportColumns: (slide) => [label(slide)],
  exportCells: (_slide, answer) => [answer ? entriesOf(answer.payload).join(', ') : null],
  label,
});

registerSlideType(wordcloudSlide);
