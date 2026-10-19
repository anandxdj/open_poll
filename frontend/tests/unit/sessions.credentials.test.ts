import { describe, expect, test } from "bun:test";

import { participantKey, readSummaryCredentials } from "@/features/sessions/credentials";

const SID_1 = "6ad5d9312eac91a3ea9e5ec1";
const SID_2 = "6ad5d9312eac91a3ea9e5ec9";

const storageOf = (entries: Record<string, string>): Storage => {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
};

const entry = (participantId: string, token = "t".repeat(24), name = "Ada") => JSON.stringify({ participantId, token, name });

describe("participant credentials for the take-home page", () => {
  test("keys are per code and session, with the per-code key as the older form", () => {
    expect(participantKey("123456", SID_1)).toBe(`openpoll_participant_123456_${SID_1}`);
    expect(participantKey("123456")).toBe("openpoll_participant_123456");
  });

  test("an explicit session reads its own entry", () => {
    const storage = storageOf({
      [participantKey("123456", SID_1)]: entry("p1"),
      [participantKey("123456", SID_2)]: entry("p2"),
    });
    expect(readSummaryCredentials(storage, "123456", SID_1)).toMatchObject({ sessionId: SID_1, participantId: "p1", name: "Ada" });
    expect(readSummaryCredentials(storage, "123456", SID_2)?.participantId).toBe("p2");
  });

  test("an explicit session never falls back to another one", () => {
    const storage = storageOf({ [participantKey("123456", SID_1)]: entry("p1"), [participantKey("123456")]: entry("legacy") });
    expect(readSummaryCredentials(storage, "123456", SID_2)).toBeNull();
  });

  test("a session id that is not an id is refused (no key guessing through the URL)", () => {
    const storage = storageOf({ [participantKey("123456", "x")]: entry("p1") });
    expect(readSummaryCredentials(storage, "123456", "x")).toBeNull();
    expect(readSummaryCredentials(storage, "123456", "../../etc")).toBeNull();
  });

  test("without a session, the newest stored session of the code wins", () => {
    const storage = storageOf({
      [participantKey("123456", SID_1)]: entry("old"),
      [participantKey("123456", SID_2)]: entry("new"),
      [participantKey("999999", "6ad5d9312eac91a3ea9e5eff")]: entry("other-code"),
    });
    expect(readSummaryCredentials(storage, "123456")).toMatchObject({ sessionId: SID_2, participantId: "new" });
  });

  test("the older per-code entry is the last resort and has no session id", () => {
    const storage = storageOf({ [participantKey("123456")]: entry("legacy") });
    expect(readSummaryCredentials(storage, "123456")).toEqual({
      sessionId: null,
      participantId: "legacy",
      token: "t".repeat(24),
      name: "Ada",
    });
  });

  test("entries without a participant and token, or that are not JSON, are ignored", () => {
    const storage = storageOf({
      [participantKey("123456", SID_1)]: "not json",
      [participantKey("123456", SID_2)]: JSON.stringify({ participantId: "p", token: "" }),
      [participantKey("123456")]: JSON.stringify({ deviceToken: "only-a-device" }),
    });
    expect(readSummaryCredentials(storage, "123456")).toBeNull();
    expect(readSummaryCredentials(storage, "123456", SID_1)).toBeNull();
  });

  test("a throwing storage reads as empty", () => {
    const broken = {
      length: 1,
      key: () => {
        throw new Error("denied");
      },
      getItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(readSummaryCredentials(broken, "123456")).toBeNull();
    expect(readSummaryCredentials(broken, "123456", SID_1)).toBeNull();
  });
});
