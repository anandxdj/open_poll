import type { Browser, BrowserContext, Page, Route } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * Billing. The e2e backend has no Stripe keys, so the real API answers in
 * disabled mode: those tests run against it unchanged. The enabled flows
 * (price display, checkout redirect, activation after paying) start from the
 * real responses and patch them with `page.route`: Stripe itself is never
 * called, and "Checkout" is a page of this app.
 */

// API payloads are patched field by field; their exact shape is the backend's, not this spec's.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const CHECKOUT_PATH = "/__stripe/checkout";

/** The real response of an API call, parsed, with `patch` applied to its `data`. */
async function patched(route: Route, patch: (data: Json) => Json) {
  const response = await route.fetch();
  const body = (await response.json()) as { data: Json };
  await route.fulfill({ response, json: { ...body, data: patch(body.data) } });
}

const pricedPlans = (data: Json): Json => ({
  ...data,
  billingEnabled: true,
  plans: data.plans.map((plan: Json) => {
    if (plan.id === "pro") {
      return {
        ...plan,
        prices: { monthly: { amount: 1500, currency: "usd" }, yearly: { amount: 14400, currency: "usd" } },
        checkout: { monthly: true, yearly: true },
      };
    }
    if (plan.id === "team") {
      return {
        ...plan,
        prices: { monthly: { amount: 1200, currency: "usd" }, yearly: { amount: 11400, currency: "usd" } },
        checkout: { monthly: true, yearly: true },
      };
    }
    return plan;
  }),
});

const billingOn = (data: Json): Json => ({
  ...data,
  enabled: true,
  checkout: { pro: { monthly: true, yearly: true }, team: { monthly: true, yearly: true } },
});

interface Session {
  user: Json;
  accessToken: string;
}

let session: Session;

// One login for the whole file: the auth routes allow 10 logins per 5 minutes per IP, and the
// suite's other specs log in too.
test.beforeAll(async () => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: e2eEnv.hostEmail, password: e2eEnv.hostPassword }),
  });
  if (!res.ok) throw new Error(`POST /auth/login -> ${res.status}`);
  session = ((await res.json()) as { data: Session }).data;
});

/**
 * A page signed in as the host, already on a protected page, so routes registered next
 * outlive the navigation to the page under test. Same seeding as the `host` fixture.
 */
async function openSignedIn(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  await context.addInitScript(
    ({ user, accessToken }) => {
      window.localStorage.setItem("auth-storage", JSON.stringify({ state: { user, accessToken }, version: 0 }));
      document.cookie = "auth_session=1; path=/; samesite=lax";
    },
    session,
  );
  const page = await context.newPage();
  await page.goto("/polls");
  return page;
}

test("billing settings says billing is off, and still shows the plan and usage", async ({ browser, contexts }) => {
  const page = await openSignedIn(browser, contexts);
  await page.goto("/settings/billing");

  await expect(page.getByTestId("billing-disabled")).toContainText("Billing is not configured on this server");
  await expect(page.getByTestId("billing-plan-name")).toHaveText(/ plan$/);
  await expect(page.getByTestId("billing-status")).toBeVisible();

  const meters = page.getByTestId("usage-meter");
  await expect(meters).toHaveCount(3);
  await expect(meters.filter({ hasText: "AI-generated decks" })).toContainText(/\d+ of \d+/);
  await expect(meters.filter({ hasText: "Imports" })).toBeVisible();
  await expect(meters.filter({ hasText: "Members" })).toBeVisible();
  await expect(page.getByText("Participants per live session or poll")).toBeVisible();

  // Nothing to buy and no portal: no fake buttons.
  await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Change plan" })).toHaveCount(0);

  // The nav entry is a working link even without Stripe.
  await expect(page.getByRole("link", { name: /^Billing/ })).toBeVisible();
});

test("the billing API refuses checkout and the portal without Stripe keys", async () => {
  const checkout = await fetch(`${e2eEnv.apiOrigin}/api/billing/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ plan: "pro", interval: "monthly" }),
  });
  expect(checkout.status).toBe(503);
  expect(((await checkout.json()) as Json).code).toBe("BILLING_DISABLED");
  const portal = await fetch(`${e2eEnv.apiOrigin}/api/billing/portal`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(portal.status).toBe(503);
});

test("subscribing sends the owner to Stripe Checkout with the chosen plan", async ({ browser, contexts }) => {
  const page = await openSignedIn(browser, contexts);
  await page.route("**/api/plans", (route) => patched(route, pricedPlans));
  await page.route("**/api/billing", (route) =>
    route.request().method() === "GET" ? patched(route, billingOn) : route.continue(),
  );
  let checkoutBody: Json | null = null;
  await page.route("**/api/billing/checkout", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    checkoutBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": e2eEnv.frontendUrl,
        "access-control-allow-credentials": "true",
        "content-type": "application/json",
      },
      json: { success: true, message: "Checkout session created", data: { url: `${e2eEnv.frontendUrl}${CHECKOUT_PATH}` } },
    });
  });
  await page.route(`**${CHECKOUT_PATH}`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Stripe Checkout</title><h1>Stripe Checkout</h1>" }),
  );

  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: "Change plan" })).toBeVisible();

  // Prices come from the API, per month and per seat for Team.
  await expect(page.getByTestId("upgrade-pro")).toContainText("$15");
  await expect(page.getByTestId("upgrade-team")).toContainText("$12");
  await expect(page.getByTestId("upgrade-team")).toContainText("/seat/month");

  await page.getByLabel("Yearly").click();
  await expect(page.getByTestId("upgrade-pro")).toContainText("$12");
  await expect(page.getByTestId("upgrade-pro")).toContainText("Billed $144 a year");

  await page.getByTestId("choose-pro").click();
  await expect(page.getByRole("heading", { name: "Stripe Checkout" })).toBeVisible();
  expect(checkoutBody).toEqual({ plan: "pro", interval: "yearly" });
});

test("a Team checkout asks for at least one seat per member", async ({ browser, contexts }) => {
  const page = await openSignedIn(browser, contexts);
  await page.route("**/api/plans", (route) => patched(route, pricedPlans));
  await page.route("**/api/billing", (route) =>
    route.request().method() === "GET"
      ? patched(route, (data) => ({ ...billingOn(data), seats: { used: 3, limit: 5, purchased: null } }))
      : route.continue(),
  );
  let checkoutBody: Json | null = null;
  await page.route("**/api/billing/checkout", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    checkoutBody = route.request().postDataJSON();
    return route.fulfill({
      status: 503,
      headers: { "access-control-allow-origin": e2eEnv.frontendUrl, "access-control-allow-credentials": "true", "content-type": "application/json" },
      json: { success: false, message: "Billing is not configured on this server", code: "BILLING_DISABLED" },
    });
  });

  await page.goto("/settings/billing");
  const team = page.getByTestId("upgrade-team");
  await expect(team.getByLabel("Seats")).toHaveValue("3");
  await team.getByLabel("Seats").fill("1");
  await team.getByTestId("choose-team").click();
  // The server never goes below the members, and the client does not send less either.
  await expect.poll(() => checkoutBody).toEqual({ plan: "team", interval: "monthly", seats: 3 });
  // A refusal is shown, and the button works again.
  await expect(page.getByText("Billing is not configured on this server").first()).toBeVisible();
  await expect(team.getByTestId("choose-team")).toBeEnabled();
});

test("after paying, the page waits for the plan and then confirms it", async ({ browser, contexts }) => {
  const page = await openSignedIn(browser, contexts);
  let reads = 0;
  await page.route("**/api/billing", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    reads += 1;
    // The webhook lands between the first and the second read.
    return patched(route, (data) =>
      reads < 2
        ? billingOn(data)
        : {
            ...billingOn(data),
            plan: "pro",
            planSource: "stripe",
            status: "active",
            subscription: { plan: "pro", interval: "monthly" },
            currentPeriodEnd: "2026-11-19T00:00:00.000Z",
            canOpenPortal: true,
            checkoutBlockedReason: "already_subscribed",
          },
    );
  });

  await page.goto("/settings/billing?checkout=success");
  await expect(page.getByTestId("checkout-status")).toContainText("activating your plan");
  await expect(page.getByTestId("checkout-status")).toContainText("Your plan is active", { timeout: 20_000 });
  await expect(page.getByTestId("billing-plan-name")).toHaveText("Pro plan");
  await expect(page.getByTestId("billing-status")).toHaveText("Active");
  await expect(page.getByText("Renews on Nov 19, 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expect(page.getByTestId("upgrade-blocked")).toContainText("already has a subscription");
});

test("a canceled checkout says nothing was charged", async ({ browser, contexts }) => {
  const page = await openSignedIn(browser, contexts);
  await page.goto("/settings/billing?checkout=canceled");
  await expect(page.getByTestId("checkout-status")).toContainText("You haven't been charged");
});

test("the landing pricing lists every plan from the API", async ({ page }) => {
  await page.goto("/");
  const pricing = page.locator("#pricing");
  await pricing.scrollIntoViewIfNeeded();
  for (const [id, name] of [["free", "Free"], ["pro", "Pro"], ["team", "Team"], ["enterprise", "Enterprise"]] as const) {
    await expect(pricing.getByTestId(`pricing-${id}`).getByText(name, { exact: true }).first()).toBeVisible();
  }
  // Limits and features are the plans' real ones; no price is invented while billing is off.
  await expect(pricing.getByTestId("pricing-free")).toContainText("Up to 100 participants per live session or poll");
  await expect(pricing.getByTestId("pricing-free")).toContainText("Free");
  await expect(pricing.getByTestId("pricing-pro")).toContainText("CSV, Excel and PDF export");
  await expect(pricing.getByTestId("pricing-pro")).toContainText("Pricing soon");
  await expect(pricing.getByTestId("pricing-enterprise")).toContainText("Single sign-on and SCIM provisioning");
  await expect(pricing.getByLabel("Yearly")).toHaveCount(0);
});

test("the landing pricing shows what the API returns: prices, the yearly toggle and changed limits", async ({ page }) => {
  await page.route("**/api/plans", (route) =>
    patched(route, (data) => {
      const priced = pricedPlans(data);
      priced.plans = priced.plans.map((plan: Json) =>
        plan.id === "free" ? { ...plan, limits: { ...plan.limits, audienceCap: 123 } } : plan,
      );
      return priced;
    }),
  );
  await page.goto("/");
  const pricing = page.locator("#pricing");
  await pricing.scrollIntoViewIfNeeded();

  await expect(pricing.getByTestId("pricing-free")).toContainText("Up to 123 participants per live session or poll");
  await expect(pricing.getByTestId("pricing-pro")).toContainText("$15");
  await expect(pricing.getByTestId("pricing-team")).toContainText("$12");
  await expect(pricing.getByTestId("pricing-team")).toContainText("/seat/month");

  await pricing.getByLabel("Yearly").click();
  await expect(pricing.getByTestId("pricing-pro")).toContainText("$12");
  await expect(pricing.getByTestId("pricing-pro")).toContainText("Billed annually ($144/year)");
  await expect(pricing.getByText("21% off")).toBeVisible();
});

test("the landing pricing falls back to the built-in plans when the API is unreachable", async ({ page }) => {
  await page.route("**/api/plans", (route) => route.abort());
  await page.goto("/");
  const pricing = page.locator("#pricing");
  await pricing.scrollIntoViewIfNeeded();
  await expect(pricing.getByTestId("pricing-free")).toContainText("Up to 100 participants per live session or poll");
  await expect(pricing.getByTestId("pricing-team")).toContainText("Priced per member");
  await expect(pricing.getByTestId("pricing-enterprise")).toBeVisible();
});
