import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Landing and sign-in surfaces: no horizontal overflow at phone, tablet and
 * desktop widths, the mobile menu, the way from the landing to login and
 * signup, the FAQ, and form labels and focus order. Public pages only, so the
 * run needs no signed-in host.
 */

const PHONE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 800 };

/** Scrolls top to bottom so every reveal-on-scroll section has rendered, then back. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const [name, size] of [["phone", PHONE], ["tablet", TABLET], ["desktop", DESKTOP]] as const) {
  test(`the landing page does not scroll sideways on a ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Slides your audience can answer" })).toBeVisible();
    await scrollThrough(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // One h1, and every section has a heading of its own.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    for (const section of ["features", "how-it-works", "pricing", "faq"]) {
      await expect(page.locator(`#${section} h2`)).toHaveCount(1);
    }
  });
}

test("the sign-in pages do not scroll sideways on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const path of ["/login", "/signup", "/forgot-password", "/reset-password/sample", "/privacy", "/terms"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
  }
});

test("the mobile menu opens, lists the sections, closes on Escape and reaches login and signup", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "Open menu" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // The desktop header links are not offered on a phone.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();

  await toggle.click();
  const menu = page.getByRole("navigation", { name: "Mobile" });
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  for (const label of ["Features", "How it works", "Pricing", "FAQ", "Join a session"]) {
    await expect(menu.getByRole("link", { name: label })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Log in to your account" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Sign up free" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
});

test("the desktop header leads to login and signup, and the section links jump to their section", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("link", { name: "FAQ" }).click();
  await expect(page).toHaveURL(/#faq$/);
  await expect(page.getByRole("heading", { name: "Questions, answered" })).toBeInViewport();

  await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Sign up free" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("the hero offers signup and the join page, and the skip link is the first stop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  const hero = page.locator("section[aria-labelledby='hero-title']");
  await expect(hero.getByRole("link", { name: "Start for free" })).toHaveAttribute("href", "/signup");
  await expect(hero.getByRole("link", { name: "Join a session" })).toHaveAttribute("href", "/live");
});

test("the FAQ opens one answer at a time from the keyboard", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/#faq");
  const first = page.getByRole("button", { name: "Does my audience need an account?" });
  const second = page.getByRole("button", { name: "Can I use my existing slides or questions?" });

  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("People join a live session with its code or QR code")).toBeVisible();

  await second.focus();
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("aria-expanded", "false");
});

test("the login form has labelled fields, a sensible focus order and a password toggle", async ({ page }) => {
  await page.goto("/login");

  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password", { exact: true });
  await expect(email).toHaveAttribute("type", "email");
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");

  // Email, then the reset link above the password field, the field, its toggle, then submit.
  await email.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  const toggle = page.getByRole("button", { name: "Show password" });
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveAttribute("type", "text");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "password");

  await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
});

test("the signup form has labelled fields and says what the password needs", async ({ page }) => {
  await page.goto("/signup");

  const name = page.getByLabel("Full name");
  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password", { exact: true });
  await expect(name).toHaveAttribute("autocomplete", "name");
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("autocomplete", "new-password");

  const hint = page.getByText("At least 8 characters, with one uppercase letter and one number.");
  await expect(hint).toBeVisible();
  await expect(password).toHaveAttribute("aria-describedby", (await hint.getAttribute("id")) ?? "");

  await name.focus();
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();

  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
});

test("privacy and terms keep the site header and footer", async ({ page }) => {
  for (const [path, title] of [["/privacy", "Privacy"], ["/terms", "Terms of use"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Open Poll home" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  }
});
