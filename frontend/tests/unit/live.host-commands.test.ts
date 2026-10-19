import { describe, expect, test } from "bun:test";
import { AxiosError, type AxiosResponse } from "axios";

import { sendHostCommand } from "@/features/presentations/components/host/hostCommands";
import type { HostCommandResponse } from "@/features/presentations/types";
import { deck, sessionView } from "./live.fixtures";

// Host commands: SESSION_BUSY is retried once; stale-console codes are flagged
// so the console re-reads the host state.

const apiFailure = (status: number, code: string | undefined, message = "no") =>
  new AxiosError("failed", undefined, undefined, undefined, {
    status,
    data: { success: false, message, ...(code ? { code } : {}) },
  } as AxiosResponse);

const response: HostCommandResponse = { ...deck({ status: "active" }), session: sessionView() };

describe("sendHostCommand", () => {
  test("returns the response of a successful command", async () => {
    let calls = 0;
    const outcome = await sendHostCommand(async () => (calls++, response), 0);
    expect(outcome).toEqual({ ok: true, response });
    expect(calls).toBe(1);
  });

  test("SESSION_BUSY is retried once and the retry's response is used", async () => {
    let calls = 0;
    const outcome = await sendHostCommand(async () => {
      calls++;
      if (calls === 1) throw apiFailure(409, "SESSION_BUSY");
      return response;
    }, 0);
    expect(outcome).toEqual({ ok: true, response });
    expect(calls).toBe(2);
  });

  test("SESSION_BUSY twice is a failure, not a loop", async () => {
    let calls = 0;
    const outcome = await sendHostCommand(async () => {
      calls++;
      throw apiFailure(409, "SESSION_BUSY", "Try again");
    }, 0);
    expect(outcome).toEqual({ ok: false, code: "SESSION_BUSY", message: "Try again", stale: false });
    expect(calls).toBe(2);
  });

  test("SESSION_ALREADY_LIVE and NO_LIVE_SESSION mean the console is out of date", async () => {
    for (const code of ["SESSION_ALREADY_LIVE", "NO_LIVE_SESSION"]) {
      let calls = 0;
      const outcome = await sendHostCommand(async () => {
        calls++;
        throw apiFailure(code === "NO_LIVE_SESSION" ? 400 : 409, code);
      }, 0);
      expect(outcome).toMatchObject({ ok: false, code, stale: true });
      expect(calls).toBe(1);
    }
  });

  test("other failures are reported with the API's message", async () => {
    expect(await sendHostCommand(async () => Promise.reject(apiFailure(403, "FORBIDDEN", "No access")), 0)).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "No access",
      stale: false,
    });
    expect(await sendHostCommand(async () => Promise.reject(new Error("offline")), 0)).toEqual({
      ok: false,
      code: undefined,
      message: undefined,
      stale: false,
    });
  });
});
