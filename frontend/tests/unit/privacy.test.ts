import { describe, expect, test } from "bun:test";

import { deletionConsequences, formatBytes, listNames, purgeDateFrom, reauthValid } from "@/features/privacy/format";
import type { PrivacyStatus } from "@/features/privacy/types";
import { retentionOptions, retentionText } from "@/features/workspaces/settings/retention";

const status = (over: Partial<PrivacyStatus> = {}): PrivacyStatus => ({
  hasPassword: true,
  reauthUntil: null,
  deletionGraceDays: 30,
  workspaces: { deleted: [{ workspaceId: "p", name: "Ada's workspace", type: "personal" }], left: [] },
  blockers: { soleOwner: [], subscriptions: [] },
  exports: [],
  exportsLeftToday: 3,
  ...over,
});

describe("privacy helpers", () => {
  test("sizes and name lists read naturally", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(24_576)).toBe("24 KB");
    expect(formatBytes(1_258_291)).toBe("1.2 MB");
    const ref = (name: string) => ({ workspaceId: name, name, type: "team" as const });
    expect(listNames([ref("Design")])).toBe("Design");
    expect(listNames([ref("Design"), ref("Sales")])).toBe("Design and Sales");
    expect(listNames([ref("Design"), ref("Sales"), ref("Ops")])).toBe("Design, Sales and Ops");
  });

  test("the confirmation says what goes, what stays and how to change your mind", () => {
    const purge = purgeDateFrom(Date.UTC(2026, 9, 26, 12), 30);
    expect(purge.toISOString()).toBe("2026-11-25T12:00:00.000Z");
    const solo = deletionConsequences(status(), purge);
    expect(solo).toHaveLength(3);
    expect(solo[1]).toContain("your account and your personal workspace");
    expect(solo[2]).toContain("Log in before November 25, 2026");

    const withTeams = deletionConsequences(
      status({
        workspaces: {
          deleted: [
            { workspaceId: "p", name: "Ada's workspace", type: "personal" },
            { workspaceId: "s", name: "Side project", type: "team" },
          ],
          left: [{ workspaceId: "d", name: "Design team", type: "team" }],
        },
      }),
      purge,
    );
    expect(withTeams[1]).toContain("your personal workspace and Side project");
    expect(withTeams[2]).toBe("You leave Design team. What you made there stays with the team.");
  });

  test("a recent sign-in or password confirmation covers deletion until it runs out", () => {
    const now = Date.UTC(2026, 9, 26, 12);
    expect(reauthValid(status(), now)).toBe(false);
    expect(reauthValid(status({ reauthUntil: new Date(now + 60_000).toISOString() }), now)).toBe(true);
    expect(reauthValid(status({ reauthUntil: new Date(now - 1).toISOString() }), now)).toBe(false);
  });
});

describe("data retention choices", () => {
  test("only what the plan allows, ending with the plan's longest", () => {
    expect(retentionOptions(365, null).map((o) => o.label)).toEqual(["30 days", "90 days", "180 days", "1 year (the plan's longest)"]);
    expect(retentionOptions(null, null).map((o) => o.label)).toEqual(["30 days", "90 days", "180 days", "1 year", "2 years", "3 years", "Forever"]);
    expect(retentionOptions(365, 45).map((o) => o.days)).toEqual([30, 45, 90, 180, null]);
  });

  test("read-only text uses the shorter of the setting and the plan", () => {
    expect(retentionText(365, null)).toBe("Kept for 1 year after a session ends");
    expect(retentionText(365, 90)).toBe("Kept for 90 days after a session ends");
    expect(retentionText(null, null)).toBe("Kept until deleted");
  });
});
