import mongoose from 'mongoose';
import { redisClient } from '../../src/common/config/redis';
import {
  PresentationModel,
  PresentationParticipantModel,
  PresentationAnswerModel,
} from '../../src/modules/presentations/presentations.model';

/**
 * Test harness for the presentations live engine.
 *
 * `installFakeRedis()` swaps the node-redis client's command methods for an
 * in-memory implementation of the subset the module uses, so the service runs
 * its real code paths (including MULTI pipelines) without a server.
 * `installModelStubs()` replaces the Mongoose statics the service calls with an
 * in-memory store. Both return a `restore()` that puts the originals back, so
 * other test files sharing the module registry are unaffected.
 */

type Entry =
  | { type: 'string'; value: string }
  | { type: 'hash'; value: Map<string, string> }
  | { type: 'set'; value: Set<string> }
  | { type: 'zset'; value: Map<string, number> }
  | { type: 'list'; value: string[] };

export interface PublishedEvent {
  channel: string;
  quizId: string;
  type: string;
  payload: Record<string, any>;
  audience?: string;
  seq?: number;
}

const toArray = (value: string | string[]) => (Array.isArray(value) ? value : [value]);

export class FakeRedis {
  store = new Map<string, Entry>();
  ttls = new Map<string, number>();
  published: PublishedEvent[] = [];

  private ensure<T extends Entry['type']>(key: string, type: T): Extract<Entry, { type: T }> {
    const existing = this.store.get(key);
    if (existing) {
      if (existing.type !== type) throw new Error(`WRONGTYPE ${key} is ${existing.type}, wanted ${type}`);
      return existing as Extract<Entry, { type: T }>;
    }
    const created = {
      type,
      value:
        type === 'string'
          ? ''
          : type === 'hash'
            ? new Map()
            : type === 'set'
              ? new Set()
              : type === 'zset'
                ? new Map()
                : [],
    } as Extract<Entry, { type: T }>;
    this.store.set(key, created);
    return created;
  }

  private read<T extends Entry['type']>(key: string, type: T): Extract<Entry, { type: T }> | undefined {
    const existing = this.store.get(key);
    if (!existing) return undefined;
    if (existing.type !== type) throw new Error(`WRONGTYPE ${key} is ${existing.type}, wanted ${type}`);
    return existing as Extract<Entry, { type: T }>;
  }

  // ---------- strings / keys ----------
  async get(key: string) {
    return this.read(key, 'string')?.value ?? null;
  }
  async set(key: string, value: string, options?: { EX?: number }) {
    this.store.set(key, { type: 'string', value: String(value) });
    if (options?.EX) this.ttls.set(key, options.EX);
    return 'OK';
  }
  async del(keys: string | string[]) {
    let removed = 0;
    for (const key of toArray(keys)) {
      if (this.store.delete(key)) removed += 1;
      this.ttls.delete(key);
    }
    return removed;
  }
  async expire(key: string, seconds: number) {
    if (!this.store.has(key)) return 0;
    this.ttls.set(key, seconds);
    return 1;
  }
  async incr(key: string) {
    const entry = this.ensure(key, 'string');
    entry.value = String(Number(entry.value || 0) + 1);
    return Number(entry.value);
  }
  async publish(channel: string, message: string) {
    const parsed = JSON.parse(message);
    this.published.push({
      channel,
      quizId: parsed.quizId,
      type: parsed.type,
      payload: parsed.payload,
      audience: parsed.audience,
      seq: parsed.seq,
    });
    return 0;
  }
  /** Only the realtime publish script (INCR the seq key, then PUBLISH the envelope) is supported. */
  async eval(script: string, options: { keys?: string[]; arguments?: string[] } = {}) {
    if (!script.includes("redis.call('PUBLISH'")) throw new Error('FakeRedis.eval: unsupported script');
    const [seqKey] = options.keys ?? [];
    const [before, after, ttl, channel] = options.arguments ?? [];
    const seq = await this.incr(seqKey!);
    await this.expire(seqKey!, Number(ttl));
    await this.publish(channel!, `${before}${seq}${after}`);
    return seq;
  }

  // ---------- hashes ----------
  async hGet(key: string, field: string) {
    return this.read(key, 'hash')?.value.get(field) ?? null;
  }
  async hSet(key: string, fieldOrObject: string | Record<string, string>, value?: string) {
    const hash = this.ensure(key, 'hash').value;
    const pairs: [string, string][] =
      typeof fieldOrObject === 'string'
        ? [[fieldOrObject, String(value)]]
        : Object.entries(fieldOrObject).map(([f, v]) => [f, String(v)]);
    let added = 0;
    for (const [f, v] of pairs) {
      if (!hash.has(f)) added += 1;
      hash.set(f, v);
    }
    return added;
  }
  async hSetNX(key: string, field: string, value: string) {
    const hash = this.ensure(key, 'hash').value;
    if (hash.has(field)) return 0;
    hash.set(field, String(value));
    return 1;
  }
  async hGetAll(key: string) {
    return Object.fromEntries(this.read(key, 'hash')?.value ?? []) as Record<string, string>;
  }
  async hLen(key: string) {
    return this.read(key, 'hash')?.value.size ?? 0;
  }
  async hIncrBy(key: string, field: string, by: number) {
    const hash = this.ensure(key, 'hash').value;
    const next = Number(hash.get(field) ?? 0) + by;
    hash.set(field, String(next));
    return next;
  }

  // ---------- sets ----------
  async sAdd(key: string, members: string | string[]) {
    const set = this.ensure(key, 'set').value;
    let added = 0;
    for (const m of toArray(members)) {
      if (!set.has(m)) {
        set.add(m);
        added += 1;
      }
    }
    return added;
  }
  async sRem(key: string, members: string | string[]) {
    const set = this.read(key, 'set')?.value;
    if (!set) return 0;
    let removed = 0;
    for (const m of toArray(members)) if (set.delete(m)) removed += 1;
    return removed;
  }
  async sCard(key: string) {
    return this.read(key, 'set')?.value.size ?? 0;
  }
  async sMembers(key: string) {
    return [...(this.read(key, 'set')?.value ?? [])];
  }

  // ---------- sorted sets ----------
  async zIncrBy(key: string, by: number, member: string) {
    const zset = this.ensure(key, 'zset').value;
    const next = (zset.get(member) ?? 0) + Number(by);
    zset.set(member, next);
    return next;
  }
  async zScore(key: string, member: string) {
    return this.read(key, 'zset')?.value.get(member) ?? null;
  }
  async zCount(key: string, min: string | number, max: string | number) {
    const parse = (bound: string | number, isMin: boolean) => {
      const raw = String(bound);
      if (raw === '+inf') return { v: Infinity, open: false };
      if (raw === '-inf') return { v: -Infinity, open: false };
      if (raw.startsWith('(')) return { v: Number(raw.slice(1)), open: true };
      return { v: Number(raw), open: false, isMin };
    };
    const lo = parse(min, true);
    const hi = parse(max, false);
    let count = 0;
    for (const score of this.read(key, 'zset')?.value.values() ?? []) {
      const aboveLo = lo.open ? score > lo.v : score >= lo.v;
      const belowHi = hi.open ? score < hi.v : score <= hi.v;
      if (aboveLo && belowHi) count += 1;
    }
    return count;
  }
  async zRangeWithScores(key: string, start: number, stop: number, options?: { REV?: boolean }) {
    const zset = this.read(key, 'zset')?.value;
    if (!zset) return [];
    // Redis orders equal scores lexicographically by member (reversed for REV).
    const sorted = [...zset.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (options?.REV) sorted.reverse();
    const end = stop < 0 ? sorted.length + stop : stop;
    return sorted.slice(start, end + 1).map(([value, score]) => ({ value, score }));
  }

  // ---------- lists ----------
  async lPush(key: string, values: string | string[]) {
    const list = this.ensure(key, 'list').value;
    for (const v of toArray(values)) list.unshift(String(v));
    return list.length;
  }
  async lTrim(key: string, start: number, stop: number) {
    const entry = this.read(key, 'list');
    if (!entry) return 'OK';
    const end = stop < 0 ? entry.value.length + stop : stop;
    entry.value = entry.value.slice(start, end + 1);
    return 'OK';
  }
  async lRange(key: string, start: number, stop: number) {
    const list = this.read(key, 'list')?.value ?? [];
    const end = stop < 0 ? list.length + stop : stop;
    return list.slice(start, end + 1);
  }

  // ---------- transactions ----------
  multi() {
    const queued: [string, unknown[]][] = [];
    const self = this;
    const chain: any = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'exec' || prop === 'execAsPipeline') {
            return async () => {
              const replies: unknown[] = [];
              for (const [name, args] of queued) replies.push(await (self as any)[name](...args));
              return replies;
            };
          }
          if (typeof (self as any)[prop] !== 'function') {
            throw new Error(`FakeRedis.multi() does not implement ${prop}`);
          }
          return (...args: unknown[]) => {
            queued.push([prop, args]);
            return chain;
          };
        },
      },
    );
    return chain;
  }

  // ---------- inspection helpers ----------
  hash(key: string) {
    return Object.fromEntries(this.read(key, 'hash')?.value ?? []) as Record<string, string>;
  }
  members(key: string) {
    return [...(this.read(key, 'set')?.value ?? [])].sort();
  }
  zset(key: string) {
    return Object.fromEntries(this.read(key, 'zset')?.value ?? []) as Record<string, number>;
  }
  events(type?: string) {
    return type ? this.published.filter((e) => e.type === type) : this.published;
  }
  lastEvent(type: string) {
    const matches = this.events(type);
    return matches[matches.length - 1];
  }
}

const REDIS_METHODS = [
  'get',
  'set',
  'del',
  'expire',
  'incr',
  'publish',
  'eval',
  'hGet',
  'hSet',
  'hSetNX',
  'hGetAll',
  'hLen',
  'hIncrBy',
  'sAdd',
  'sRem',
  'sCard',
  'sMembers',
  'zIncrBy',
  'zScore',
  'zCount',
  'zRangeWithScores',
  'lPush',
  'lTrim',
  'lRange',
  'multi',
] as const;

const patch = (target: any, name: string, replacement: unknown) => {
  const own = Object.getOwnPropertyDescriptor(target, name);
  target[name] = replacement;
  return () => {
    if (own) Object.defineProperty(target, name, own);
    else delete target[name];
  };
};

export function installFakeRedis() {
  const fake = new FakeRedis();
  const restorers = REDIS_METHODS.map((name) =>
    patch(redisClient, name, (...args: unknown[]) => (fake as any)[name](...args)),
  );
  return {
    redis: fake,
    restore() {
      restorers.reverse().forEach((r) => r());
    },
  };
}

// ---------------------------------------------------------------------------
// Mongo stand-ins
// ---------------------------------------------------------------------------

export interface StoredParticipant {
  _id: mongoose.Types.ObjectId;
  presentationId: string;
  deviceId: string;
  name: string;
  token: string;
  score: number;
  correctCount: number;
  joinedAt: Date;
}

const compareBy = (spec: Record<string, 1 | -1>) => (a: any, b: any) => {
  for (const [field, dir] of Object.entries(spec)) {
    const av = a[field] instanceof Date ? a[field].getTime() : a[field];
    const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
    if (av < bv) return -dir;
    if (av > bv) return dir;
  }
  return 0;
};

/** Minimal chainable stand-in for a Mongoose Query (sort/limit/select/lean, awaitable). */
const query = <T>(result: () => T): any => {
  const q: any = {
    sort: (spec: Record<string, 1 | -1>) =>
      query(() => {
        const r = result();
        return (Array.isArray(r) ? [...r].sort(compareBy(spec)) : r) as T;
      }),
    limit: (n: number) =>
      query(() => {
        const r = result();
        return (Array.isArray(r) ? r.slice(0, n) : r) as T;
      }),
    select: () => q,
    lean: () => Promise.resolve(result()),
    then: (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result()).catch(reject),
  };
  return q;
};

const matches = (doc: Record<string, any>, filter: Record<string, any>) =>
  Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === 'object' && '$gt' in expected) return actual > expected.$gt;
    return String(actual) === String(expected);
  });

export function installModelStubs() {
  const presentations: any[] = [];
  const participants: StoredParticipant[] = [];
  const answers: Record<string, any>[] = [];
  const participantUpdates: { filter: any; update: any }[] = [];
  const restorers: (() => void)[] = [];

  const findPresentation = (id: unknown) => presentations.find((p) => String(p._id) === String(id)) ?? null;

  restorers.push(
    patch(PresentationModel, 'findById', (id: unknown) => query(() => findPresentation(id))),
    patch(PresentationModel, 'findOne', (filter: Record<string, unknown>) =>
      query(() => presentations.find((p) => matches(p, filter)) ?? null),
    ),
    patch(PresentationModel, 'findByIdAndDelete', (id: unknown) =>
      query(() => {
        const index = presentations.findIndex((p) => String(p._id) === String(id));
        return index >= 0 ? presentations.splice(index, 1)[0] : null;
      }),
    ),
    patch(PresentationParticipantModel, 'findOneAndUpdate', (filter: any, update: any) =>
      query(() => {
        let participant = participants.find((p) => matches(p, filter));
        if (!participant) {
          participant = {
            _id: new mongoose.Types.ObjectId(),
            presentationId: String(filter.presentationId),
            deviceId: filter.deviceId,
            ...update.$setOnInsert,
          } as StoredParticipant;
          participants.push(participant);
        }
        return participant;
      }),
    ),
    patch(PresentationParticipantModel, 'updateOne', (filter: any, update: any) => {
      participantUpdates.push({ filter, update });
      const participant = participants.find((p) => String(p._id) === String(filter._id));
      if (participant && update.$inc) {
        for (const [field, by] of Object.entries(update.$inc)) {
          (participant as any)[field] += by as number;
        }
      }
      return query(() => ({ acknowledged: true }));
    }),
    patch(PresentationParticipantModel, 'countDocuments', (filter: any) =>
      query(() => participants.filter((p) => matches(p, filter)).length),
    ),
    patch(PresentationParticipantModel, 'find', (filter: any) =>
      query(() => participants.filter((p) => matches(p, filter))),
    ),
    patch(PresentationParticipantModel, 'findOne', (filter: any) =>
      query(() => participants.find((p) => matches(p, filter)) ?? null),
    ),
    patch(PresentationParticipantModel, 'deleteMany', (filter: any) =>
      query(() => {
        const keep = participants.filter((p) => !matches(p, filter));
        const deletedCount = participants.length - keep.length;
        participants.splice(0, participants.length, ...keep);
        return { deletedCount };
      }),
    ),
    patch(PresentationAnswerModel, 'create', (data: any) => {
      const duplicate = answers.some(
        (a) =>
          String(a.presentationId) === String(data.presentationId) &&
          a.slideIndex === data.slideIndex &&
          String(a.participantId) === String(data.participantId),
      );
      if (duplicate) return Promise.reject(Object.assign(new Error('E11000'), { code: 11000 }));
      answers.push({ ...data });
      return Promise.resolve(data);
    }),
    patch(PresentationAnswerModel, 'countDocuments', (filter: any) =>
      query(() => answers.filter((a) => matches(a, filter)).length),
    ),
    patch(PresentationAnswerModel, 'findOne', (filter: any) =>
      query(() => answers.find((a) => matches(a, filter)) ?? null),
    ),
    patch(PresentationAnswerModel, 'deleteMany', (filter: any) =>
      query(() => {
        const keep = answers.filter((a) => !matches(a, filter));
        const deletedCount = answers.length - keep.length;
        answers.splice(0, answers.length, ...keep);
        return { deletedCount };
      }),
    ),
  );

  return {
    presentations,
    participants,
    answers,
    participantUpdates,
    /** Builds a real (unsaved) Presentation document; `save()` just resolves. */
    addPresentation(data: Record<string, unknown>) {
      const doc: any = new PresentationModel(data);
      doc.save = async () => doc;
      presentations.push(doc);
      return doc;
    },
    /** Pushes an already-built object (bypasses Mongoose casting). */
    addRawPresentation(doc: any) {
      doc.save ??= async () => doc;
      presentations.push(doc);
      return doc;
    },
    restore() {
      restorers.reverse().forEach((r) => r());
    },
  };
}

/** Lets fire-and-forget promise chains (write-behind) settle. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

export const OWNER_ID = 'owner-user-id';
