import { describe, expect, test } from "bun:test";

import {
  addSlide,
  cloneSlide,
  duplicateSlide,
  moveSlide,
  removeSlide,
  type RailState,
} from "@/features/presentations/components/builder/slideRailOps";
import { blankSlide } from "@/features/presentations/slides/editor";
import type { PresentationSlide } from "@/features/presentations/types/deck";

const slide = (question: string): PresentationSlide => ({ ...blankSlide("select_answer"), question });

/** Deck of slides named A, B, C… with `active` selected. */
function deck(names: string, active = 0): RailState {
  return { slides: names.split("").map(slide), active };
}

const names = (state: RailState) => state.slides.map((s) => s.question).join("");

describe("moveSlide", () => {
  test("moves down and up, the moved slide stays selected", () => {
    const down = moveSlide(deck("ABCD", 1), 1, 3);
    expect(names(down)).toBe("ACDB");
    expect(down.active).toBe(3);

    const up = moveSlide(deck("ABCD", 2), 2, 0);
    expect(names(up)).toBe("CABD");
    expect(up.active).toBe(0);
  });

  test("selection follows its slide when another slide moves across it", () => {
    // B selected; A moves below it, so B shifts up.
    const a = moveSlide(deck("ABCD", 1), 0, 2);
    expect(names(a)).toBe("BCAD");
    expect(a.slides[a.active].question).toBe("B");

    // C selected; D moves above it, so C shifts down.
    const b = moveSlide(deck("ABCD", 2), 3, 1);
    expect(names(b)).toBe("ADBC");
    expect(b.slides[b.active].question).toBe("C");

    // Moves that don't cross the selection leave it alone.
    const c = moveSlide(deck("ABCD", 0), 2, 3);
    expect(names(c)).toBe("ABDC");
    expect(c.active).toBe(0);
  });

  test("same index or out of range is a no-op", () => {
    const state = deck("ABC", 1);
    expect(moveSlide(state, 1, 1)).toBe(state);
    expect(moveSlide(state, 0, -1)).toBe(state);
    expect(moveSlide(state, 2, 3)).toBe(state);
    expect(moveSlide(state, 5, 0)).toBe(state);
  });

  test("does not mutate the input", () => {
    const state = deck("ABC", 0);
    moveSlide(state, 0, 2);
    expect(names(state)).toBe("ABC");
  });
});

describe("duplicateSlide", () => {
  test("inserts a copy right after the source and selects it", () => {
    const next = duplicateSlide(deck("ABC", 0), 1);
    expect(names(next)).toBe("ABBC");
    expect(next.active).toBe(2);
  });

  test("the copy is deep and has no server id", () => {
    const source: PresentationSlide = { ...slide("A"), _id: "server-id" };
    const next = duplicateSlide({ slides: [source], active: 0 }, 0);
    const copy = next.slides[1];
    expect(copy._id).toBeUndefined();
    expect(next.slides[0]._id).toBe("server-id");

    copy.options[0].text = "changed";
    expect(next.slides[0].options[0].text).toBe("");
    expect(cloneSlide(source)).not.toHaveProperty("_id");
  });

  test("out of range is a no-op", () => {
    const state = deck("AB", 0);
    expect(duplicateSlide(state, 2)).toBe(state);
  });
});

describe("removeSlide", () => {
  test("keeps at least one slide", () => {
    const state = deck("A", 0);
    expect(removeSlide(state, 0)).toBe(state);
  });

  test("selection: earlier slide removed shifts it up, later slide leaves it", () => {
    const earlier = removeSlide(deck("ABCD", 2), 0);
    expect(names(earlier)).toBe("BCD");
    expect(earlier.slides[earlier.active].question).toBe("C");

    const later = removeSlide(deck("ABCD", 1), 3);
    expect(names(later)).toBe("ABC");
    expect(later.active).toBe(1);
  });

  test("removing the selected slide selects the one that takes its place, or the new last", () => {
    const middle = removeSlide(deck("ABCD", 1), 1);
    expect(names(middle)).toBe("ACD");
    expect(middle.active).toBe(1);

    const last = removeSlide(deck("ABCD", 3), 3);
    expect(names(last)).toBe("ABC");
    expect(last.active).toBe(2);
  });
});

describe("addSlide", () => {
  test("appends a blank slide of the picked type and selects it", () => {
    const next = addSlide(deck("AB", 0), "ranking");
    expect(next.slides).toHaveLength(3);
    expect(next.slides[2]).toEqual(blankSlide("ranking"));
    expect(next.active).toBe(2);
  });
});
