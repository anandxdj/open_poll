import { describe, expect, test } from "bun:test";

import { splitPresence, type DeckEditor } from "@/features/presentations/components/builder/useDeckPresence";

const editor = (userId: string, tabs = 1): DeckEditor => ({ userId, name: `User ${userId}`, since: "2026-11-05T10:00:00.000Z", tabs });

describe("builder presence", () => {
  test("lists the other editors and notices the user's own other tabs", () => {
    expect(splitPresence([editor("me"), editor("a"), editor("b", 2)], "me")).toEqual({
      others: [editor("a"), editor("b", 2)],
      selfElsewhere: false,
    });
    expect(splitPresence([editor("me", 2)], "me")).toEqual({ others: [], selfElsewhere: true });
    expect(splitPresence([], "me")).toEqual({ others: [], selfElsewhere: false });
    // Signed-out (no id): everyone counts as someone else.
    expect(splitPresence([editor("a")], null).others).toHaveLength(1);
  });
});
