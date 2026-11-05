import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Accessibility scans (W4-A) with axe-core. Every scan runs the WCAG 2.0, 2.1
 * and 2.2 A/AA rules plus axe's best practices on the whole page, after the
 * page's animations have settled (a fading element would otherwise be measured
 * half transparent). A serious or critical finding fails the test (softly, so
 * one run lists every surface); every finding of any impact is written to
 * `test-results/axe/findings.jsonl` (one line per scan) for the checklist in
 * `docs/compliance/a11y-checklist.md`.
 */

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const BLOCKING = new Set(["serious", "critical"]);
const REPORT_DIR = path.resolve(__dirname, "../test-results/axe");

export interface AxeFinding {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: { target: string; html: string; summary?: string }[];
}

/**
 * Waits until finite CSS animations and Web Animations (entrance fades, framer-motion) have
 * finished and the next frames are painted. Transitions are skipped: a running timer bar
 * restarts its width transition every 100 ms and would never settle.
 */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => !(animation instanceof CSSTransition) && animation.effect?.getTiming().iterations !== Infinity);
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // framer-motion springs that run on requestAnimationFrame are not Web Animations.
  await page.waitForTimeout(350);
}

/**
 * Scans the page and fails the test (softly) on any serious or critical
 * finding. `surface` names the screen in the report, e.g. "participant · answering · light".
 */
export async function expectNoSeriousA11yViolations(page: Page, surface: string) {
  const started = Date.now();
  await settle(page);
  const settled = Date.now();
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const analysed = Date.now();
  const findings: AxeFinding[] = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 8).map((node) => ({
      target: node.target.join(" "),
      html: node.html.slice(0, 240),
      summary: node.failureSummary?.slice(0, 400),
    })),
  }));
  mkdirSync(REPORT_DIR, { recursive: true });
  appendFileSync(
    path.join(REPORT_DIR, "findings.jsonl"),
    `${JSON.stringify({ surface, url: page.url(), passes: results.passes.length, settleMs: settled - started, axeMs: analysed - settled, findings })}\n`
  );
  const blocking = findings.filter((finding) => BLOCKING.has(finding.impact ?? ""));
  expect
    .soft(
      blocking.map((finding) => `${finding.impact} ${finding.id}: ${finding.help} → ${finding.nodes.map((n) => n.target).join(", ")}`),
      `${surface}: serious or critical axe findings`
    )
    .toEqual([]);
}

/** Sets the app theme the way the profile switch does (next-themes, localStorage `theme`). */
export async function setAppTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => window.localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

export const IMAGE_URL = "https://images.e2e.test/map.svg";
const IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#dbeafe"/><circle cx="300" cy="120" r="30" fill="#1d4ed8"/>
</svg>`;

/** Answers the slide images and the YouTube player locally, so the scans need no network. */
export async function stubMedia(page: Page) {
  await page.route("https://images.e2e.test/**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: IMAGE })
  );
  await page.route("https://www.youtube-nocookie.com/**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html lang=en><title>Video player</title><p>player</p></html>",
    })
  );
}
