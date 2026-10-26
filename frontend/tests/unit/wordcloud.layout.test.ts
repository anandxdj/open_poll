import { describe, expect, test } from "bun:test";

import {
  advance,
  EMPTY_CLOUD,
  KEEP_ON_RESET,
  LIVE_LIMIT,
  type CloudState,
  type Measure,
  type PlacedWord,
  type Word,
} from "@/features/presentations/slides/types/wordcloud/cloudLayout";

// Monospace-ish ink: 0.6em per letter, 0.75em tall, centred on the line box.
const measure: Measure = (text, fontSize) => ({ width: text.length * fontSize * 0.6, height: fontSize * 0.75, dx: 0, dy: 0 });
const FRAME = { width: 640, height: 300 };

const find = (cloud: CloudState, text: string) => cloud.words.find((w) => w.text === text);

/** Feeds answers one at a time, like a live session. */
function stream(answers: string[], start: CloudState = EMPTY_CLOUD, counts = new Map<string, number>()) {
  let cloud = start;
  for (const answer of answers) {
    counts.set(answer, (counts.get(answer) ?? 0) + 1);
    const words: Word[] = [...counts].map(([text, count]) => ({ text, count }));
    cloud = advance(cloud, words, FRAME, measure);
  }
  return { cloud, counts };
}

function box(w: PlacedWord) {
  const width = w.text.length * w.fontSize * 0.6;
  const height = w.fontSize * 0.75;
  const [hw, hh] = w.rotate ? [height / 2, width / 2] : [width / 2, height / 2];
  return { left: w.x - hw, right: w.x + hw, top: w.y - hh, bottom: w.y + hh };
}

describe("live word cloud", () => {
  test("a word keeps its spot while new words arrive", () => {
    const first = stream(["practical"]).cloud;
    const at = find(first, "practical")!;
    const { cloud } = stream(["fun", "clear", "useful", "hands-on", "engaging"], first, new Map([["practical", 1]]));
    expect(find(cloud, "practical")).toMatchObject({ x: at.x, y: at.y });
  });

  test("a repeated word grows in place", () => {
    const { cloud: before, counts } = stream(["practical", "fun", "clear"]);
    const was = find(before, "practical")!;
    const { cloud } = stream(["practical", "practical", "practical"], before, counts);
    const now = find(cloud, "practical")!;
    expect(now.fontSize).toBeGreaterThan(was.fontSize);
    expect({ x: now.x, y: now.y }).toEqual({ x: was.x, y: was.y });
  });

  test("words never overlap and stay inside the frame", () => {
    const answers = Array.from({ length: 30 }, (_, i) => `word${i % 18}`);
    const { cloud } = stream(answers);
    const boxes = cloud.words.map(box);
    for (const [i, a] of boxes.entries()) {
      expect(a.left).toBeGreaterThanOrEqual(-FRAME.width / 2);
      expect(a.right).toBeLessThanOrEqual(FRAME.width / 2);
      expect(a.top).toBeGreaterThanOrEqual(-FRAME.height / 2);
      expect(a.bottom).toBeLessThanOrEqual(FRAME.height / 2);
      for (const b of boxes.slice(i + 1)) {
        const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart).toBe(true);
      }
    }
  });

  test("a full cloud starts over with its top words in place", () => {
    const popular = ["alpha", "alpha", "alpha", "alpha", "bravo", "bravo", "bravo", "charlie", "charlie"];
    const { cloud: early, counts } = stream(popular);
    const spots = Object.fromEntries(early.words.map((w) => [w.text, { x: w.x, y: w.y }]));
    const many = Array.from({ length: LIVE_LIMIT + 5 }, (_, i) => `w${i}`);
    const { cloud } = stream(many, early, counts);

    expect(cloud.words.length).toBeLessThanOrEqual(LIVE_LIMIT);
    for (const top of ["alpha", "bravo", "charlie"].slice(0, KEEP_ON_RESET)) {
      expect(find(cloud, top)).toMatchObject(spots[top]);
    }
    // The newest answer is on screen; some earlier single answers gave way.
    expect(find(cloud, `w${LIVE_LIMIT + 4}`)).toBeDefined();
    expect(find(cloud, "w0")).toBeUndefined();
  });

  test("a word that dropped out comes back when someone sends it again", () => {
    const { cloud: early, counts } = stream(["alpha", "alpha", "bravo", "charlie", "delta"]);
    const many = Array.from({ length: LIVE_LIMIT + 5 }, (_, i) => `w${i}`);
    const { cloud: full, counts: after } = stream(many, early, counts);
    expect(find(full, "delta")).toBeUndefined();
    const { cloud } = stream(["delta"], full, after);
    expect(find(cloud, "delta")).toBeDefined();
  });

  test("nothing to show without words or a frame", () => {
    expect(advance(EMPTY_CLOUD, [], FRAME, measure)).toEqual(EMPTY_CLOUD);
    expect(advance(EMPTY_CLOUD, [{ text: "a", count: 1 }], { width: 0, height: 0 }, measure)).toEqual(EMPTY_CLOUD);
  });
});

describe("finished word cloud (fit)", () => {
  test("shows every word, shrinking to fit", () => {
    const words = Array.from({ length: 70 }, (_, i) => ({ text: `answer${i}`, count: (i % 5) + 1 }));
    const cloud = advance(EMPTY_CLOUD, words, FRAME, measure, "fit");
    expect(cloud.words).toHaveLength(70);
  });
});
