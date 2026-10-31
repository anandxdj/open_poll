import { describe, expect, test } from "bun:test";

import { activeNavHref, MAIN_NAV, WORKSPACE_NAV } from "@/components/layouts/nav";
import { firstName, greetingFor, spacedJoinCode } from "@/features/home/greeting";

const ALL = [...MAIN_NAV, ...WORKSPACE_NAV];

describe("activeNavHref", () => {
  test("marks the page and the pages opened from it", () => {
    expect(activeNavHref("/home", ALL)).toBe("/home");
    expect(activeNavHref("/polls", ALL)).toBe("/polls");
    expect(activeNavHref("/presentation/create", ALL)).toBe("/polls");
    expect(activeNavHref("/presentations/abc/sessions/def", ALL)).toBe("/polls");
    expect(activeNavHref("/create", ALL)).toBe("/polls");
    expect(activeNavHref("/analytics/123", ALL)).toBe("/analytics");
  });

  test("prefers the longest prefix, so Members wins over Settings", () => {
    expect(activeNavHref("/settings/members", ALL)).toBe("/settings/members");
    expect(activeNavHref("/settings/billing", ALL)).toBe("/settings");
    expect(activeNavHref("/settings", ALL)).toBe("/settings");
  });

  test("matches whole path segments only", () => {
    expect(activeNavHref("/homework", ALL)).toBeNull();
    expect(activeNavHref("/settingsx", ALL)).toBeNull();
    expect(activeNavHref(null, ALL)).toBeNull();
  });
});

describe("Home header helpers", () => {
  test("greets by the time of day", () => {
    expect(greetingFor(4)).toBe("Good evening");
    expect(greetingFor(5)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(16)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good evening");
  });

  test("uses the first word of the name, or nothing", () => {
    expect(firstName("  Priya   Sharma ")).toBe("Priya");
    expect(firstName("")).toBeNull();
    expect(firstName("   ")).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  test("groups a six-digit join code in threes and leaves anything else alone", () => {
    expect(spacedJoinCode("482913")).toBe("482 913");
    expect(spacedJoinCode("ABC123")).toBe("ABC123");
  });
});
