import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { redisClient } from '../../../common/config/redis';
import { timeRedis } from '../../../common/observability/redisTiming';
import type { RedisOp } from '../slides';
import { SESSION_KEY_TTL_SEC, k } from './keys';

/**
 * The one-call answer path. `lua/answer.lua` holds the script (window check,
 * participant auth, rate limit, dedup, the slide type's ops, scores, stored
 * result, coalescer mark); this file loads it, builds its KEYS/ARGV and reads
 * its reply. Any `RedisOp` kind the registry defines runs through the script's
 * generic op loop, never per slide type.
 */

export const ANSWER_SCRIPT = readFileSync(new URL('./lua/answer.lua', import.meta.url), 'utf8');
const ANSWER_SCRIPT_SHA = createHash('sha1').update(ANSWER_SCRIPT).digest('hex');

/** Wire values of `RedisOp.op` the script understands. */
export const SCRIPT_OP_KINDS: RedisOp['op'][] = ['hincrby', 'hsetnx', 'lpush_trim'];

/** Per-participant attempt budget: more than this many authenticated attempts in the window is refused. */
export const ANSWER_RATE_MAX = 30;
export const ANSWER_RATE_WINDOW_MS = 10_000;
/** Answers this late after a timed slide's deadline are still taken (network latency). */
export const ANSWER_GRACE_MS = 750;
/** Grace for answers carrying a valid slide ticket. */
export const TICKET_GRACE_MS = 15_000;
/** The coalescer's window: one host `answer:received` per dirty slide per this long. */
export const DIRTY_WINDOW_MS = 250;

export interface AnswerScriptInput {
  sessionId: string;
  slideId: string;
  participantId: string;
  participantToken: string;
  slideIndex: number;
  startedAtMs: number;
  nowMs: number;
  ticketOk: boolean;
  score: number;
  isCorrect: boolean;
  /** The `StoredAnswerResult` JSON written to `:results:{slideId}`. */
  storedJson: string;
  ops: RedisOp[];
}

export type AnswerScriptReject =
  | 'CLOSED'
  | 'NO_WINDOW'
  | 'STALE'
  | 'NO_TOKEN'
  | 'BAD_TOKEN'
  | 'KICKED'
  | 'RATE_LIMITED'
  | 'TIME_UP'
  | 'BAD_OP';

export type AnswerScriptReply =
  | { status: 'OK'; answeredCount: number; ownsDirtyWindow: boolean }
  | { status: 'DUP'; storedJson: string; answeredCount: number }
  | { status: AnswerScriptReject };

export const scriptKeys = (input: AnswerScriptInput) => {
  const { sessionId: sid, slideId, participantId } = input;
  return [
    k.meta(sid),
    k.slides(sid),
    k.kicked(sid),
    k.tokens(sid),
    k.answered(sid, slideId),
    k.results(sid, slideId),
    k.scores(sid),
    k.correct(sid),
    k.answerRate(sid, participantId),
    k.dirty(sid),
    k.dirtySlides(sid),
    k.dist(sid, slideId),
    k.disp(sid, slideId),
    k.feed(sid, slideId),
  ];
};

export const scriptArguments = (input: AnswerScriptInput) => [
  input.participantId,
  input.participantToken,
  input.slideId,
  String(input.slideIndex),
  String(input.startedAtMs),
  String(input.nowMs),
  input.ticketOk ? '1' : '0',
  String(input.score),
  input.isCorrect ? '1' : '0',
  input.storedJson,
  JSON.stringify(input.ops),
  String(ANSWER_RATE_MAX),
  String(ANSWER_RATE_WINDOW_MS),
  String(DIRTY_WINDOW_MS),
  String(SESSION_KEY_TTL_SEC),
  String(ANSWER_GRACE_MS),
  String(TICKET_GRACE_MS),
];

const isNoScript = (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes('NOSCRIPT');

/** EVALSHA, loading the script on the first call (or after a Redis restart / SCRIPT FLUSH). */
const runScript = async (input: AnswerScriptInput): Promise<unknown> => {
  const options = { keys: scriptKeys(input), arguments: scriptArguments(input) };
  try {
    return await redisClient.evalSha(ANSWER_SCRIPT_SHA, options);
  } catch (error) {
    if (!isNoScript(error)) throw error;
    return redisClient.eval(ANSWER_SCRIPT, options);
  }
};

const asReply = (raw: unknown): AnswerScriptReply => {
  if (!Array.isArray(raw)) throw new Error('Unexpected reply from the answer script');
  const status = String(raw[0]);
  if (status === 'OK') return { status: 'OK', answeredCount: Number(raw[1]), ownsDirtyWindow: Number(raw[2]) === 1 };
  if (status === 'DUP') return { status: 'DUP', storedJson: String(raw[1] ?? ''), answeredCount: Number(raw[2]) };
  return { status } as AnswerScriptReply;
};

/** Runs the answer script. Rejections come back as a reply; only Redis failures throw. */
export const runAnswerScript = async (input: AnswerScriptInput): Promise<AnswerScriptReply> =>
  asReply(await timeRedis('answer_script', () => runScript(input)));
