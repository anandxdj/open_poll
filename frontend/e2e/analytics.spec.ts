import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * Analytics overview (W3-G workspace insights) against the real API: the
 * headline numbers, the activity chart, top decks and polls and recent
 * sessions, and switching the range refetches.
 */

test("the analytics overview shows workspace insights and switches range", async ({ host }) => {
  // The API answers for this workspace over the default 30 days.
  const res = await fetch(`${e2eEnv.apiOrigin}/api/insights`, { headers: { Authorization: `Bearer ${host.accessToken}` } });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: { range: { days: number }; daily: unknown[] } };
  expect(data.range.days).toBe(30);
  expect(data.daily.length).toBeGreaterThanOrEqual(30);

  const page = await host.open("/analytics");
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
  for (const label of ["Sessions", "Participants", "Responses", "Engagement"]) {
    await expect(page.locator("dt", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top decks and polls" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent sessions" })).toBeVisible();

  const range = page.getByRole("group", { name: "Date range" });
  await expect(range.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
  const refetch = page.waitForResponse((r) => r.url().includes("/api/insights") && r.status() === 200);
  await range.getByRole("button", { name: "7 days" }).click();
  await refetch;
  await expect(range.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/in the last 7 days, per day in your time zone/)).toBeVisible();

  const shown = page.getByRole("group", { name: "Activity shown" });
  await shown.getByRole("button", { name: "Sessions" }).click();
  await expect(page.getByText(/sessions in the last 7 days/)).toBeVisible();
});
