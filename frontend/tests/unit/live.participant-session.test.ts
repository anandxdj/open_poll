import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  credentialsKey,
  deviceKey,
  forgetCredentials,
  readCredentials,
  readDevice,
  saveJoin,
  writeDevice,
} from "@/features/presentations/components/participant/participantSession";

// Participant identity in localStorage: credentials per session, one device
// record per code. tests/setup/storage.ts provides a localStorage shim.

const SELF = { participantId: "p1", name: "Ada", token: "tok-1" };

beforeEach(() => localStorage.clear());

describe("keys", () => {
  test("credentials are keyed by code and session; the device record by code alone", () => {
    expect(credentialsKey("123456", "sess-a")).toBe("openpoll_participant_123456_sess-a");
    expect(deviceKey("123456")).toBe("openpoll_participant_123456");
  });
});

describe("credentials per session", () => {
  test("a join is stored under its session and read back", () => {
    saveJoin("123456", "sess-a", SELF, "device-1");
    expect(JSON.parse(localStorage.getItem("openpoll_participant_123456_sess-a")!)).toEqual(SELF);
    expect(readCredentials("123456", "sess-a")).toEqual(SELF);
  });

  test("another session of the same code has no credentials", () => {
    saveJoin("123456", "sess-a", SELF, "device-1");
    expect(readCredentials("123456", "sess-b")).toBeNull();
    expect(readCredentials("654321", "sess-a")).toBeNull();
    expect(readCredentials("123456", null)).toBeNull();
    expect(readCredentials("123456", undefined)).toBeNull();
  });

  test("two sessions keep their own identities", () => {
    saveJoin("123456", "sess-a", SELF, "device-1");
    saveJoin("123456", "sess-b", { participantId: "p9", name: "Ada", token: "tok-9" }, "device-1");
    expect(readCredentials("123456", "sess-a")?.participantId).toBe("p1");
    expect(readCredentials("123456", "sess-b")?.participantId).toBe("p9");
  });

  test("forgetting removes only that session's credentials and keeps the device record", () => {
    saveJoin("123456", "sess-a", SELF, "device-1");
    saveJoin("123456", "sess-b", { participantId: "p9", name: "Ada", token: "tok-9" }, "device-1");
    forgetCredentials("123456", "sess-a");
    expect(readCredentials("123456", "sess-a")).toBeNull();
    expect(readCredentials("123456", "sess-b")).not.toBeNull();
    expect(readDevice("123456").deviceToken).toBe("device-1");
    forgetCredentials("123456", null);
  });

  test("incomplete or corrupt entries read as absent", () => {
    localStorage.setItem(credentialsKey("123456", "sess-a"), JSON.stringify({ participantId: "p1", name: "Ada" }));
    expect(readCredentials("123456", "sess-a")).toBeNull();
    localStorage.setItem(credentialsKey("123456", "sess-b"), "{not json");
    expect(readCredentials("123456", "sess-b")).toBeNull();
    localStorage.setItem(credentialsKey("123456", "sess-c"), "[1,2]");
    expect(readCredentials("123456", "sess-c")).toBeNull();
  });
});

describe("device record", () => {
  test("a join remembers the device token, nickname and last session", () => {
    saveJoin("123456", "sess-a", SELF, "device-1");
    expect(readDevice("123456")).toEqual({ deviceToken: "device-1", name: "Ada", lastSessionId: "sess-a" });
  });

  test("patching keeps what is not mentioned", () => {
    writeDevice("123456", { deviceToken: "device-1", name: "Ada" });
    writeDevice("123456", { lastSessionId: "sess-a" });
    expect(readDevice("123456")).toEqual({ deviceToken: "device-1", name: "Ada", lastSessionId: "sess-a" });
  });

  test("an empty device record reads as empty fields", () => {
    expect(readDevice("123456")).toEqual({ deviceToken: undefined, name: undefined, lastSessionId: undefined });
  });

  test("the pre-session format (credentials under the code alone) is not mistaken for a session", () => {
    localStorage.setItem(deviceKey("123456"), JSON.stringify({ participantId: "p1", name: "Ada", token: "old", deviceToken: "device-1" }));
    expect(readDevice("123456")).toEqual({ deviceToken: "device-1", name: "Ada", lastSessionId: undefined });
    expect(readCredentials("123456", "sess-a")).toBeNull();
  });
});

describe("blocked storage", () => {
  test("writes and reads never throw", () => {
    const set = spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const get = spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      expect(() => saveJoin("123456", "sess-a", SELF, "device-1")).not.toThrow();
      expect(readCredentials("123456", "sess-a")).toBeNull();
      expect(readDevice("123456").deviceToken).toBeUndefined();
    } finally {
      set.mockRestore();
      get.mockRestore();
    }
  });
});
