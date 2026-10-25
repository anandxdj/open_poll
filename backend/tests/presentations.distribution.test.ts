import { describe, expect, it } from 'bun:test';
import { redisClient } from '../src/common/config/redis';
import { PresentationParticipantModel } from '../src/modules/presentations/presentations.model';
import { computeSlideDistributionHelper } from '../src/modules/presentations/presentations.service';

const SESSION_ID = '64b7f0c2a1b2c3d4e5f60718';
const SLIDE_ID = '64b7f0c2a1b2c3d4e5f60719';

/**
 * Stubs the four Redis reads the helper makes and records which keys it asked
 * for. The helper reads one live session's keys for one slide id (the
 * session-scoped, hash-tagged `psess:{<sid>}:*` map), which these tests pin.
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

  it('reads session-scoped, hash-tagged keys and builds option counts', async () => {
    const stub = stubRedis({ [`psess:{${SESSION_ID}}:dist:${SLIDE_ID}`]: { '0': '4', '2': '1' } }, 5, 6);
    try {
      const result = await computeSlideDistributionHelper(SESSION_ID, SLIDE_ID, slide);

      expect(stub.keys.sort()).toEqual(
        [
          `psess:{${SESSION_ID}}:answered:${SLIDE_ID}`,
          `psess:{${SESSION_ID}}:disp:${SLIDE_ID}`,
          `psess:{${SESSION_ID}}:dist:${SLIDE_ID}`,
          `psess:{${SESSION_ID}}:names`,
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

  it("falls back to counting the session's participants in Mongo when the Redis names hash is gone", async () => {
    const stub = stubRedis({}, 0, 0);
    try {
      const result = await computeSlideDistributionHelper(SESSION_ID, SLIDE_ID, slide);

      expect(result.participantCount).toBe(7);
      expect(stub.countFilter()).toEqual({ sessionId: SESSION_ID });
    } finally {
      stub.restore();
    }
  });
});
