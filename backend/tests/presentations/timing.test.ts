import { describe, expect, it } from 'bun:test';
import type { ISlideState } from '../../src/modules/presentations/models/session.model';
import { timerPatch } from '../../src/modules/presentations/live/timing.service';
import { activeElapsedMs, endPausePatch, slidePhase, timerBudgetMs } from '../../src/modules/presentations/live/state';
import { autoRevealDueAt } from '../../src/modules/presentations/live/autoReveal';

/** W2-A timer arithmetic: pause, resume, extend, skip, the budget and speed-scoring time. */

const T0 = new Date('2026-11-05T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

const running = (overrides: Partial<ISlideState> = {}): ISlideState => ({
  openedAt: T0,
  endsAt: at(20_000),
  pausedRemainingMs: null,
  pausedAt: null,
  pausedMs: 0,
  closedAt: null,
  revealedAt: null,
  ...overrides,
});

const apply = (state: ISlideState, patch: Partial<ISlideState>): ISlideState => ({ ...state, ...patch });

describe('timer actions', () => {
  it('pause freezes the time left and clears the deadline; the slide stays open', () => {
    const paused = apply(running(), timerPatch(running(), 'pause', at(5_000)));
    expect(paused).toMatchObject({ endsAt: null, pausedRemainingMs: 15_000, pausedAt: at(5_000) });
    expect(slidePhase('response', paused, at(60_000).getTime())).toBe('open');
    expect(timerBudgetMs(paused)).toBe(20_000);
  });

  it('resume sets a new deadline from the frozen time and adds the pause to pausedMs', () => {
    const paused = apply(running(), timerPatch(running(), 'pause', at(5_000)));
    const resumed = apply(paused, timerPatch(paused, 'resume', at(12_000)));
    expect(resumed).toMatchObject({ endsAt: at(27_000), pausedRemainingMs: null, pausedAt: null, pausedMs: 7_000 });
    expect(timerBudgetMs(resumed)).toBe(20_000);
  });

  it('refuses pausing twice, resuming a running timer and pausing a timer that ran out', () => {
    const paused = apply(running(), timerPatch(running(), 'pause', at(5_000)));
    expect(() => timerPatch(paused, 'pause', at(6_000))).toThrow('already paused');
    expect(() => timerPatch(running(), 'resume', at(6_000))).toThrow('not paused');
    expect(() => timerPatch(running(), 'pause', at(21_000))).toThrow('Time is already up');
  });

  it('extend moves the deadline (or the frozen time) and grows the budget; a timer that ran out restarts from now', () => {
    expect(apply(running(), timerPatch(running(), 'extend', at(5_000), 30))).toMatchObject({ endsAt: at(50_000) });
    const late = apply(running(), timerPatch(running(), 'extend', at(21_000), 30));
    expect(late.endsAt).toEqual(at(51_000));
    expect(timerBudgetMs(late)).toBe(51_000);
    const paused = apply(running(), timerPatch(running(), 'pause', at(5_000)));
    const grown = apply(paused, timerPatch(paused, 'extend', at(6_000), 10));
    expect(grown).toMatchObject({ endsAt: null, pausedRemainingMs: 25_000 });
    expect(timerBudgetMs(grown)).toBe(30_000);
  });

  it("skip makes it time's up now, ending a pause", () => {
    const paused = apply(running(), timerPatch(running(), 'pause', at(5_000)));
    const skipped = apply(paused, timerPatch(paused, 'skip', at(8_000)));
    expect(skipped).toMatchObject({ endsAt: at(8_000), pausedRemainingMs: null, pausedAt: null, pausedMs: 3_000 });
    expect(slidePhase('response', skipped, at(8_001).getTime())).toBe('closed');
  });

  it('closing a paused window ends the pause', () => {
    const paused = apply(running(), timerPatch(running(), 'pause', at(5_000)));
    expect(endPausePatch(paused, at(9_000))).toEqual({ pausedAt: null, pausedRemainingMs: null, pausedMs: 4_000 });
    expect(endPausePatch(running(), at(9_000))).toEqual({ pausedAt: null, pausedRemainingMs: null });
  });

  it('an untimed window has no budget', () => {
    expect(timerBudgetMs(running({ endsAt: null }))).toBeNull();
  });
});

describe('speed-scoring time (activeElapsedMs)', () => {
  const window = { startedAtMs: T0.getTime(), pausedAtMs: null as number | null, pausedMs: 0 };

  it('is the time since opening while the timer never paused', () => {
    expect(activeElapsedMs(window, T0.getTime() + 4_000)).toBe(4_000);
  });

  it('leaves out finished pauses', () => {
    expect(activeElapsedMs({ ...window, pausedMs: 7_000 }, T0.getTime() + 10_000)).toBe(3_000);
  });

  it('counts an answer landing during a pause as arriving when the pause began', () => {
    expect(activeElapsedMs({ ...window, pausedAtMs: T0.getTime() + 2_000 }, T0.getTime() + 2_500)).toBe(2_000);
  });

  it('never goes negative', () => {
    expect(activeElapsedMs({ ...window, pausedMs: 99_000 }, T0.getTime() + 1_000)).toBe(0);
  });
});

describe('auto-reveal while paused', () => {
  it('is never scheduled for a paused window', () => {
    expect(
      autoRevealDueAt({ slideId: 's', open: true, scored: true, endsAtMs: null, pausedRemainingMs: 5_000 })
    ).toBeNull();
  });
});
