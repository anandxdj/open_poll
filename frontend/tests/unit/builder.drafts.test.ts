import { describe, expect, test } from "bun:test";

import { deckSignature } from "@/features/presentations/components/builder/deckDraft";
import { blankSlide } from "@/features/presentations/slides/editor";

describe("deck signature (no local draft or save without a real edit)", () => {
  test("equal for the same content, also after a JSON round trip (the local draft)", () => {
    const slides = [{ ...blankSlide("wordcloud"), _id: "s1", question: "One word?" }];
    const roundTripped = JSON.parse(JSON.stringify(slides));
    expect(deckSignature("Deck", roundTripped)).toBe(deckSignature("Deck", slides));
    expect(deckSignature(" Deck ", slides)).toBe(deckSignature("Deck", slides));
  });

  test("differs on a title or slide edit, and is equal again once the edit is undone", () => {
    const slides = [{ ...blankSlide("wordcloud"), _id: "s1", question: "One word?" }];
    const base = deckSignature("Deck", slides);
    expect(deckSignature("Deck 2", slides)).not.toBe(base);
    const edited = [{ ...slides[0]!, question: "Two words?" }];
    expect(deckSignature("Deck", edited)).not.toBe(base);
    expect(deckSignature("Deck", [{ ...edited[0]!, question: "One word?" }])).toBe(base);
  });
});
