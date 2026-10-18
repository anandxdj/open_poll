import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { ResponseService } from '../src/modules/responses/responses.service';
import { ResponsesController } from '../src/modules/responses/responses.controller';
import { submitResponseSchema } from '../src/modules/responses/responses.schema';
import { validate } from '../src/common/middlewares/validate.middleware';
import { PollModel } from '../src/modules/polls/polls.model';
import { ResponseModel } from '../src/modules/responses/responses.model';
import { redisClient } from '../src/common/config/redis';
import { issueBallotToken } from '../src/common/utils/signedId.utils';

// In-memory stand-in for the Redis commands the vote path uses. Every command
// yields to the event loop first so concurrent requests genuinely interleave:
// a get-then-set dedup lets both through here, an atomic SET NX must not.
function createFakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    store,
    ttls,
    get: async (key: string) => {
      await tick();
      return store.get(key) ?? null;
    },
    set: async (key: string, value: string, opts?: any) => {
      await tick();
      if ((opts?.condition === 'NX' || opts?.NX) && store.has(key)) return null;
      store.set(key, value);
      const ttl = opts?.expiration?.value ?? opts?.EX;
      if (ttl !== undefined) ttls.set(key, ttl);
      return 'OK';
    },
    setEx: async (key: string, ttl: number, value: string) => {
      await tick();
      store.set(key, value);
      ttls.set(key, ttl);
      return 'OK';
    },
    incr: async (key: string) => {
      await tick();
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    },
    expire: async (key: string, ttl: number) => {
      await tick();
      ttls.set(key, ttl);
      return 1;
    },
    del: async (key: string) => {
      await tick();
      return store.delete(key) ? 1 : 0;
    },
    multi: () => {
      const chain: any = {
        sAdd: () => chain,
        incr: () => chain,
        hIncrBy: () => chain,
        exec: async () => [],
      };
      return chain;
    },
  };
}

const REDIS_METHODS = ['get', 'set', 'setEx', 'incr', 'expire', 'del', 'multi'] as const;

function makePoll(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    creatorId: 'creator-1',
    title: 'Security Poll',
    pollType: 'POLL',
    passingScorePercentage: 70,
    isAnonymous: true,
    isPublished: true,
    isClosed: false,
    expiresAt: new Date(Date.now() + 3 * 86400_000),
    questions: [
      {
        _id: new mongoose.Types.ObjectId(),
        text: 'Pick one',
        options: ['A', 'B'],
        type: 'single',
        correctOptionIndices: [0],
        points: 1,
        isMandatory: true,
      },
    ],
    ...overrides,
  };
}

let redis: ReturnType<typeof createFakeRedis>;
let poll: ReturnType<typeof makePoll>;
let created: any[];
const originals: Record<string, unknown> = {};

beforeEach(() => {
  redis = createFakeRedis();
  poll = makePoll();
  created = [];

  for (const method of REDIS_METHODS) {
    originals[`redis.${method}`] = (redisClient as any)[method];
    (redisClient as any)[method] = (redis as any)[method];
  }
  originals.findById = PollModel.findById;
  originals.create = ResponseModel.create;
  originals.countDocuments = ResponseModel.countDocuments;
  originals.exists = ResponseModel.exists;

  (PollModel as any).findById = async () => poll;
  (ResponseModel as any).create = async (doc: any) => {
    created.push(doc);
    return doc;
  };
  const sameRespondent = (doc: any, filter: any) =>
    String(doc.pollId) === String(filter.pollId) && doc.respondentId === filter.respondentId;
  (ResponseModel as any).countDocuments = async (filter: any) =>
    created.filter((doc) => sameRespondent(doc, filter)).length;
  (ResponseModel as any).exists = async (filter: any) =>
    created.some((doc) => sameRespondent(doc, filter) && doc.passed === filter.passed)
      ? { _id: new mongoose.Types.ObjectId() }
      : null;
});

afterEach(() => {
  for (const method of REDIS_METHODS) {
    (redisClient as any)[method] = originals[`redis.${method}`];
  }
  (PollModel as any).findById = originals.findById;
  (ResponseModel as any).create = originals.create;
  (ResponseModel as any).countDocuments = originals.countDocuments;
  (ResponseModel as any).exists = originals.exists;
});

const pollId = () => String(poll._id);
const answer = (optionIndex: number) => [
  { questionId: String(poll.questions[0]!._id), selectedOptionIndex: optionIndex },
];
const newBallot = async () => (await ResponseService.issueBallot(pollId())).ballotToken;
const ballotIdOf = (token: string) => token.split('.')[1];

const expectApiError = async (promise: Promise<unknown>, statusCode: number) => {
  const error: any = await promise.then(
    () => null,
    (err) => err,
  );
  expect(error?.statusCode).toBe(statusCode);
  return error;
};

/** Runs the real validation middleware + controller, as the route does. */
async function submitThroughController(body: Record<string, unknown>) {
  const req: any = { body, ip: '203.0.113.7' };
  const res: any = {
    statusCode: 0,
    payload: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  let error: any;
  validate(submitResponseSchema)(req, res, (err?: unknown) => {
    error = err;
  });
  if (!error) {
    await ResponsesController.submit(req, res, (err?: unknown) => {
      error = err;
    });
  }
  return error ? { status: error.statusCode as number, error } : { status: res.statusCode as number };
}

describe('vote dedup is anchored on server-issued ballots', () => {
  it('rotating deviceId cannot reuse a ballot to vote twice', async () => {
    const ballotToken = await newBallot();

    await ResponseService.submitResponse(
      { pollId: pollId(), ballotToken, deviceId: 'device-a', answers: answer(0) },
      { clientIp: '198.51.100.1' },
    );
    await expectApiError(
      ResponseService.submitResponse(
        { pollId: pollId(), ballotToken, deviceId: 'device-b', answers: answer(1) },
        { clientIp: '198.51.100.1' },
      ),
      409,
    );
    expect(created).toHaveLength(1);
  });

  it('a client-chosen string or another poll’s ballot is not a ballot', async () => {
    await expectApiError(
      ResponseService.submitResponse({
        pollId: pollId(),
        ballotToken: 'device-a-'.repeat(5),
        answers: answer(0),
      }),
      403,
    );
    const { token: otherPollBallot } = issueBallotToken(String(new mongoose.Types.ObjectId()));
    await expectApiError(
      ResponseService.submitResponse({ pollId: pollId(), ballotToken: otherPollBallot, answers: answer(0) }),
      403,
    );
    expect(created).toHaveLength(0);
  });

  it('two concurrent submits with the same ballot: exactly one succeeds', async () => {
    const ballotToken = await newBallot();
    const submit = (deviceId: string) =>
      ResponseService.submitResponse(
        { pollId: pollId(), ballotToken, deviceId, answers: answer(0) },
        { clientIp: '198.51.100.1' },
      );

    const results = await Promise.allSettled([submit('device-a'), submit('device-b')]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason.statusCode).toBe(409);
    expect(created).toHaveLength(1);
  });

  it('an identified voter cannot vote again with fresh ballots, even concurrently', async () => {
    const [ballotA, ballotB] = [await newBallot(), await newBallot()];
    const submit = (ballotToken: string) =>
      ResponseService.submitResponse(
        { pollId: pollId(), ballotToken, answers: answer(0) },
        { userId: 'user-1' },
      );

    const results = await Promise.allSettled([submit(ballotA), submit(ballotB)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expectApiError(submit(await newBallot()), 409);
    expect(created).toHaveLength(1);
  });

  it('anonymous votes persist anon:<ballotId>, never the deviceId', async () => {
    const ballotToken = await newBallot();
    await ResponseService.submitResponse({
      pollId: pollId(),
      ballotToken,
      deviceId: 'device-a',
      answers: answer(0),
    });

    expect(created[0].respondentId).toBe(`anon:${ballotIdOf(ballotToken)}`);
  });

  it('spent-ballot markers outlive the poll so a ballot cannot be replayed later', async () => {
    const ballotToken = await newBallot();
    await ResponseService.submitResponse({ pollId: pollId(), ballotToken, answers: answer(0) });

    const ttl = redis.ttls.get(`poll:${pollId()}:ballot:${ballotIdOf(ballotToken)}`)!;
    const secondsUntilExpiry = (poll.expiresAt.getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(secondsUntilExpiry);
  });

  it('caps anonymous votes per IP per poll', async () => {
    redis.store.set(`poll:${pollId()}:voted:ip:198.51.100.9`, '50');
    await expectApiError(
      ResponseService.submitResponse(
        { pollId: pollId(), ballotToken: await newBallot(), answers: answer(0) },
        { clientIp: '198.51.100.9' },
      ),
      429,
    );
  });

  it('refuses ballots for polls that are not open', async () => {
    poll = makePoll({ isPublished: false });
    await expectApiError(ResponseService.issueBallot(pollId()), 400);
    poll = makePoll({ isClosed: true });
    await expectApiError(ResponseService.issueBallot(pollId()), 400);
  });
});

describe('respondent identity comes only from verified sources', () => {
  it('ignores a body respondentId on anonymous polls', async () => {
    const ballotToken = await newBallot();
    const victimId = String(new mongoose.Types.ObjectId());

    const result = await submitThroughController({
      pollId: pollId(),
      ballotToken,
      respondentId: victimId,
      answers: answer(0),
    });

    expect(result.status).toBe(201);
    expect(created[0].respondentId).toBe(`anon:${ballotIdOf(ballotToken)}`);
  });

  it('a body respondentId does not satisfy a non-anonymous poll', async () => {
    poll = makePoll({ isAnonymous: false });

    const result = await submitThroughController({
      pollId: pollId(),
      ballotToken: await newBallot(),
      respondentId: String(new mongoose.Types.ObjectId()),
      answers: answer(0),
    });

    expect(result.status).toBe(401);
    expect(created).toHaveLength(0);
  });

  it('rejects self-asserted and forged guest identities', async () => {
    poll = makePoll({ isAnonymous: false });

    const asBody = await submitThroughController({
      pollId: pollId(),
      ballotToken: await newBallot(),
      respondentId: 'guest:victim@example.com:Victim',
      answers: answer(0),
    });
    expect(asBody.status).toBe(401);

    const asToken = await submitThroughController({
      pollId: pollId(),
      ballotToken: await newBallot(),
      guestToken: 'guest:victim@example.com:Victim',
      answers: answer(0),
    });
    expect(asToken.status).toBe(401);

    // A genuine signature over someone else's payload must not verify either.
    const { guestToken } = ResponseService.issueGuestIdentity({ name: 'Jane', email: 'jane@example.com' });
    const [, , signature] = guestToken.split('.');
    const forgedPayload = Buffer.from('victim@example.com\nVictim', 'utf8').toString('base64url');
    const tampered = await submitThroughController({
      pollId: pollId(),
      ballotToken: await newBallot(),
      guestToken: `g.${forgedPayload}.${signature}`,
      answers: answer(0),
    });
    expect(tampered.status).toBe(401);

    expect(created).toHaveLength(0);
  });

  it('a server-signed guest token identifies the voter and dedups them', async () => {
    poll = makePoll({ isAnonymous: false });
    const { guestToken } = ResponseService.issueGuestIdentity({ name: 'Jane', email: 'jane@example.com' });

    const first = await submitThroughController({
      pollId: pollId(),
      ballotToken: await newBallot(),
      guestToken,
      answers: answer(0),
    });
    const second = await submitThroughController({
      pollId: pollId(),
      ballotToken: await newBallot(),
      guestToken,
      answers: answer(1),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(created).toHaveLength(1);
    expect(created[0].respondentId).toBe('guest:jane@example.com:Jane');
  });
});

describe('TRIAL retries still work under single-use ballots', () => {
  beforeEach(() => {
    poll = makePoll({ pollType: 'TRIAL', isAnonymous: false, passingScorePercentage: 100 });
  });

  const attempt = async (optionIndex: number, ballotToken?: string) =>
    (await ResponseService.submitResponse(
      { pollId: pollId(), ballotToken: ballotToken ?? (await newBallot()), answers: answer(optionIndex) },
      { userId: 'learner-1' },
    )) as { trialResult: { passed: boolean; attemptNumber: number } };

  it('an identified respondent retries with fresh ballots until passing, then is stopped', async () => {
    const first = await attempt(1);
    const second = await attempt(1);
    const third = await attempt(0);

    expect([first, second, third].map((r) => r.trialResult.attemptNumber)).toEqual([1, 2, 3]);
    expect([first, second, third].map((r) => r.trialResult.passed)).toEqual([false, false, true]);
    await expectApiError(attempt(0), 409);
    expect(created).toHaveLength(3);
    // The per-respondent attempt lock is always released.
    expect([...redis.store.keys()].some((key) => key.includes(':trial:lock:'))).toBe(false);
  });

  it('a trial ballot is still single-use', async () => {
    const ballotToken = await newBallot();
    await attempt(1, ballotToken);
    await expectApiError(attempt(1, ballotToken), 409);
    expect(created).toHaveLength(1);
  });

  it('concurrent attempts by one respondent are serialized, not double-graded', async () => {
    // Failing answers, so only the attempt lock (not the passed gate) can stop the second.
    const results = await Promise.allSettled([attempt(1), attempt(1)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  it('anonymous trials allow retries, numbered by the device hint', async () => {
    poll = makePoll({ pollType: 'TRIAL', isAnonymous: true, passingScorePercentage: 100 });
    const anonAttempt = async () =>
      (await ResponseService.submitResponse({
        pollId: pollId(),
        ballotToken: await newBallot(),
        deviceId: 'device-a',
        answers: answer(1),
      })) as { trialResult: { attemptNumber: number } };

    const first = await anonAttempt();
    const second = await anonAttempt();

    expect([first.trialResult.attemptNumber, second.trialResult.attemptNumber]).toEqual([1, 2]);
    expect(created.map((doc) => doc.respondentId).every((id) => id.startsWith('anon:'))).toBe(true);
    expect(created[0].respondentId).not.toBe(created[1].respondentId);
  });
});
