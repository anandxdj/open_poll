import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { dismissNativeDialogs, expect, test } from "./fixtures";

/**
 * /settings/profile as a person uses it: rename yourself (the sidebar and the
 * Home greeting follow), change the password (a wrong current password is
 * refused inline), log out, and only the new password signs in again.
 */

const backendEnv = {
  ...process.env,
  MONGO_URI: e2eEnv.mongoUri,
  REDIS_URL: e2eEnv.redisUrl,
};

/** A fresh verified account; the script also clears the auth rate-limit windows. */
const seedUser = (email: string, password: string, name: string) =>
  execFileSync("bun", ["scripts/seed-e2e-user.ts", email, password, name], {
    cwd: e2eEnv.backendDir,
    env: backendEnv,
    stdio: "pipe",
  });

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("rename yourself, change your password, sign in with the new one", async ({ browser, contexts }) => {
  const email = `e2e-profile-${Date.now()}@openpoll.test`;
  const oldPassword = "E2eProfile!2345";
  const newPassword = "E2eProfile!6789";
  seedUser(email, oldPassword, "Pat Profile");

  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  dismissNativeDialogs(page);
  const accountMenu = page.getByRole("button", { name: "Account menu" });

  await logIn(page, email, oldPassword);
  await expect(page).toHaveURL(/\/home/);
  await expect(accountMenu).toContainText("Pat Profile");

  // Name: Save is off until it changes; an empty name is refused inline.
  await accountMenu.click();
  await page.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/settings\/profile/);
  const nameField = page.getByLabel("Full name");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(nameField).toHaveValue("Pat Profile");
  await expect(save).toBeDisabled();

  await nameField.fill("   ");
  await save.click();
  await expect(page.getByText("Enter your name.")).toBeVisible();

  await nameField.fill("Robin Renamed");
  await save.click();
  await expect(page.getByText("Name saved")).toBeVisible();
  await expect(accountMenu).toContainText("Robin Renamed");
  await expect(save).toBeDisabled();

  // It is stored, not just shown: a reload and Home read it back from the API.
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Robin Renamed");
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Robin");
  await expect(accountMenu).toContainText("Robin Renamed");

  // Password: a wrong current password and a mismatch are shown next to their fields.
  await page.goto("/settings/profile");
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  const current = page.getByLabel("Current password", { exact: true });
  const next = page.getByLabel("New password", { exact: true });
  const confirm = page.getByLabel("Confirm new password", { exact: true });
  const submit = page.getByRole("button", { name: "Change password" });

  // Show/hide works like on the sign-in pages.
  await current.fill("Not-my-password1");
  await expect(current).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).first().click();
  await expect(current).toHaveAttribute("type", "text");

  await next.fill(newPassword);
  await confirm.fill("Something!else1");
  await submit.click();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();

  await confirm.fill(newPassword);
  await submit.click();
  await expect(page.getByText("That isn't your current password.")).toBeVisible();
  await expect(current).toHaveAttribute("aria-invalid", "true");

  await current.fill(oldPassword);
  await submit.click();
  await expect(page.getByText("Password changed. Other devices were signed out.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "still signed in here" })).toBeVisible();
  await expect(current).toHaveValue("");

  // Still signed in with the new tokens: app pages keep loading.
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Robin Renamed");

  await accountMenu.click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await logIn(page, email, oldPassword);
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await logIn(page, email, newPassword);
  await expect(page).toHaveURL(/\/home/);
  await expect(accountMenu).toContainText("Robin Renamed");
});
