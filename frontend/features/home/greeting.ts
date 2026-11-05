// Pure helpers for the Home header. No React, no network — unit tested in tests/unit.

/** "Good morning" before noon, "Good afternoon" until 5 PM, "Good evening" after (and before 5 AM). */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The first word of a display name, or null when there is no name to show. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Thursday, October 30" in the viewer's time zone. */
export const todayLabel = (date: Date) =>
  date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/** "482 913": a six-digit join code in two groups, as the stage shows it. */
export const spacedJoinCode = (code: string) => (/^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code);
