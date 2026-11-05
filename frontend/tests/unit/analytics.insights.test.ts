import { describe, expect, test } from "bun:test";

import { countChange, formatDay, formatPercent, rangeFor, rateChange, timeAgo } from "@/features/analytics/insights";

describe("insights helpers", () => {
  test("a range is the last N days up to now", () => {
    const now = Date.UTC(2026, 9, 26, 12);
    expect(rangeFor(7, now)).toEqual({ from: "2026-10-19T12:00:00.000Z", to: "2026-10-26T12:00:00.000Z" });
  });

  test("counts change as a percentage, or a plain difference after an empty period", () => {
    expect(countChange(118, 100)).toEqual({ trend: "up", amount: "+18%" });
    expect(countChange(75, 100)).toEqual({ trend: "down", amount: "−25%" });
    expect(countChange(5, 0)).toEqual({ trend: "up", amount: "+5" });
    expect(countChange(0, 4)).toEqual({ trend: "down", amount: "−100%" });
    expect(countChange(9, 9)).toEqual({ trend: "flat", amount: "0%" });
    expect(countChange(0, 0)).toEqual({ trend: "flat", amount: null });
  });

  test("rates change in percentage points", () => {
    expect(rateChange(0.76, 0.72)).toEqual({ trend: "up", amount: "+4 pts" });
    expect(rateChange(0.5, 0.61)).toEqual({ trend: "down", amount: "−11 pts" });
    expect(rateChange(0.5, 0.5)).toEqual({ trend: "flat", amount: "0 pts" });
    expect(rateChange(0.5, null)).toEqual({ trend: "flat", amount: null });
  });

  test("formats percents, days and recent times", () => {
    expect(formatPercent(0.923)).toBe("92%");
    expect(formatPercent(null)).toBe("–");
    expect(formatDay("2026-10-05")).toBe("Oct 5");
    expect(formatDay("2026-10-05", true)).toBe("Oct 5, 2026");
    const now = Date.UTC(2026, 9, 26, 12);
    expect(timeAgo(new Date(now - 20_000).toISOString(), now)).toBe("just now");
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3 hours ago");
    expect(timeAgo(new Date(now - 86400_000).toISOString(), now)).toBe("yesterday");
  });
});
