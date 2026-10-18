import { describe, expect, it } from 'bun:test';
import { redisClient } from '../src/common/config/redis';
import { PresentationParticipantModel } from '../src/modules/presentations/presentations.model';
import { computeSlideDistributionHelper } from '../src/modules/presentations/presentations.service';

const PRESENTATION_ID = '64b7f0c2a1b2c3d4e5f60718';

/**
 * Stubs the four Redis reads the helper makes and records which keys it asked
 * for. The helper used to take a 'presentation' | 'quiz' key prefix and a
 * participant model for the dead quizzes module; it now reads presentation keys
 * only, which these tests pin.
 */
function stubRedis(hashes: Record<string, Record<string, string>>, answered: number, names: number) {
  const original = {
    hGetAll: redisClient.hGetAll,
    sCard: redisClient.sCard,
    hLen: redisClient.hLen,
    countDocuments: PresentationParticipantModel.countDocuments,
  };
  const keys: string[] = [];
  let countFilter: unknown;

  (redisClient as any).hGetAll = async (key: string) => {
    keys.push(key);
    return hashes[key] ?? {};
  };
  (redisClient as any).sCard = async (key: string) => {
    keys.push(key);
    return answered;
  };
  (redisClient as any).hLen = async (key: string) => {
    keys.push(key);
    return names;
  };
  (PresentationParticipantModel as any).countDocuments = async (filter: unknown) => {
    countFilter = filter;
    return 7;
  };

  return {
    keys,
    countFilter: () => countFilter,
    restore() {
      (redisClient as any).hGetAll = original.hGetAll;
      (redisClient as any).sCard = original.sCard;
      (redisClient as any).hLen = original.hLen;
      (PresentationParticipantModel as any).countDocuments = original.countDocuments;
    },
  };
}

describe('computeSlideDistributionHelper', () => {
  const slide = {
    type: 'select_answer',
    options: [
      { text: 'Mercury', isCorrect: true },
      { text: 'Venus', isCorrect: false },
      { text: 'Earth', isCorrect: false },
    ],
  };

  it('reads presentation-namespaced keys and builds option counts', async () => {
    const stub = stubRedis({ [`presentation:${PRESENTATION_ID}:dist:2`]: { '0': '4', '2': '1' } }, 5, 6);
    try {
      const result = await computeSlideDistributionHelper(PRESENTATION_ID, 2, slide);

      expect(stub.keys.sort()).toEqual(
        [
          `presentation:${PRESENTATION_ID}:answered:2`,
          `presentation:${PRESENTATION_ID}:disp:2`,
          `presentation:${PRESENTATION_ID}:dist:2`,
          `presentation:${PRESENTATION_ID}:names`,
        ].sort(),
      );
      expect(result.distribution).toEqual({
        kind: 'options',
        counts: [4, 0, 1],
        options: slide.options,
      });
      expect(result.answeredCount).toBe(5);
      expect(result.participantCount).toBe(6);
      expect(stub.countFilter()).toBeUndefined();
    } finally {
      stub.restore();
    }
  });

  it('falls back to counting participants in Mongo when the Redis names hash is gone', async () => {
    const stub = stubRedis({}, 0, 0);
    try {
      const result = await computeSlideDistributionHelper(PRESENTATION_ID, 0, slide);

      expect(result.participantCount).toBe(7);
      expect(stub.countFilter()).toEqual({ presentationId: PRESENTATION_ID });
    } finally {
      stub.restore();
    }
  });
});
