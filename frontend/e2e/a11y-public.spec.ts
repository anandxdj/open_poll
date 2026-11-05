import { expectNoSeriousA11yViolations as scan, setAppTheme } from "./axe";
import { expect, test } from "./fixtures";

/**
 * W4-A accessibility of the public pages: the landing page, login, signup and
 * the join page (code entry), in the light and the dark app theme, on a phone
 * and a desktop. Zero serious or critical axe findings.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** Scrolls top to bottom so every reveal-on-scroll section has rendered, then back. */
async function scrollThrough(page: import("@playwright/test").Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const theme of ["light", "dark"] as const) {
  for (const [device, size] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
    test(`public pages have no serious axe findings (${theme} app, ${device})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(size);
      await page.goto("/");
      await setAppTheme(page, theme);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scrollThrough(page);
      await scan(page, `landing · ${theme} · ${device}`);

      for (const path of ["/login", "/signup"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await scan(page, `${path.slice(1)} · ${theme} · ${device}`);
      }

      await page.goto("/live");
      await expect(page.getByRole("button", { name: "Join" })).toBeVisible();
      await scan(page, `join page · ${theme} · ${device}`);
      // A wrong code: the error toast is announced and scanned too.
      await page.getByPlaceholder("000000").fill("12");
      await page.getByRole("button", { name: "Join" }).click();
      await expect(page.getByText("Enter the 6-digit code from your host.")).toBeVisible();
      await scan(page, `join page · invalid code · ${theme} · ${device}`);
    });
  }
}
