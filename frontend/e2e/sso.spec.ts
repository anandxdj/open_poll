import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * Single sign-on and SCIM (W3-D) as an admin and a colleague see them: on an
 * Enterprise team workspace, add a SAML connection from IdP metadata, add a
 * domain (the DNS proof is simulated in the database), turn sign-in on, and a
 * colleague's "Continue with SSO" goes to the IdP. Then create a SCIM token,
 * use it, revoke it.
 */

const backendEnv = {
  ...process.env,
  MONGO_URI: e2eEnv.mongoUri,
  REDIS_URL: e2eEnv.redisUrl,
  FRONTEND_URL: e2eEnv.frontendUrl,
  JWT_ACCESS_SECRET: "e2e-access-secret",
  JWT_REFRESH_SECRET: "e2e-refresh-secret",
  ID_SIGNING_SECRET: "e2e-id-signing-secret",
};

const bun = (args: string[]) => execFileSync("bun", args, { cwd: e2eEnv.backendDir, env: backendEnv, stdio: "pipe" });

interface Account {
  user: { _id: string; email: string; name: string };
  accessToken: string;
}

const apiJson = async <T>(p: string, init: RequestInit & { token?: string; workspaceId?: string } = {}): Promise<T> => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api${p}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.workspaceId ? { "X-Workspace-Id": init.workspaceId } : {}),
    },
  });
  expect(res.ok, `${init.method ?? "GET"} ${p} → ${res.status}`).toBe(true);
  return ((await res.json()) as { data: T }).data;
};

async function openAs(browser: Browser, contexts: BrowserContext[], account: Account, workspaceId: string, p: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  await context.addCookies([{ name: "auth_session", value: "1", url: e2eEnv.frontendUrl }]);
  await context.addInitScript(
    ({ user, accessToken, workspaceId }) => {
      window.localStorage.setItem("auth-storage", JSON.stringify({ state: { user, accessToken }, version: 0 }));
      window.localStorage.setItem("openpoll_workspace", JSON.stringify({ state: { userId: user._id, currentWorkspaceId: workspaceId }, version: 1 }));
    },
    { user: account.user, accessToken: account.accessToken, workspaceId },
  );
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.documentElement.appendChild(style);
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(p);
  return page;
}

/** IdP metadata around the committed fixture certificate (backend/tests/fixtures/saml). */
const idpMetadata = () => {
  const cert = readFileSync(path.join(e2eEnv.backendDir, "tests/fixtures/saml/idp-cert.pem"), "utf8")
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.test/metadata"><md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.test/sso"/></md:IDPSSODescriptor></md:EntityDescriptor>`;
};

test("an admin sets up SAML sign-in and SCIM; a colleague's SSO sign-in goes to the IdP", async ({ browser, contexts }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const email = `e2e-sso-${stamp}@openpoll.test`;
  const password = "E2eSso!23456";
  const domain = `e2e-${stamp}.example.com`;
  bun(["scripts/seed-e2e-user.ts", email, password, "Sam Admin"]);
  const account = await apiJson<Account>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const { workspace } = await apiJson<{ workspace: { _id: string; slug: string } }>("/workspaces", {
    method: "POST",
    token: account.accessToken,
    body: JSON.stringify({ name: `SSO team ${stamp}` }),
  });
  bun(["scripts/set-plan.ts", workspace.slug, "enterprise"]);

  // ---- A SAML connection from metadata ----
  const page = await openAs(browser, contexts, account, workspace._id, "/settings/sso");
  await expect(page.getByRole("heading", { name: "Single sign-on" })).toBeVisible();
  await page.getByRole("button", { name: "SAML connection" }).click();
  await page.getByLabel("Name").fill("Okta");
  await page.getByRole("button", { name: "Create connection" }).click();
  const card = page.getByRole("article", { name: "Okta" });
  await expect(card.getByText("ACS URL (reply URL)")).toBeVisible();
  await expect(card.getByText(`${e2eEnv.apiOrigin}/api/sso/saml/`).first()).toBeVisible();
  await card.getByLabel("Paste the IdP metadata XML").fill(idpMetadata());
  await card.getByRole("button", { name: "Import metadata" }).click();
  await expect(card.getByText(/https:\/\/idp\.example\.test\/metadata · 1 signing certificate/)).toBeVisible();

  // ---- A domain, proven (simulated: no DNS in tests) ----
  await card.getByLabel("Domain", { exact: true }).fill(domain);
  await card.getByRole("button", { name: "Add domain" }).click();
  await expect(card.getByText("Waiting for DNS")).toBeVisible();
  await expect(card.getByText(`_openpoll.${domain}`)).toBeVisible();
  bun([
    "-e",
    `const m = require('mongoose'); await m.connect(process.env.MONGO_URI);
     await m.connection.db.collection('ssoconnections').updateOne({ 'domains.domain': '${domain}' }, { $set: { 'domains.$.verifiedAt': new Date() } });
     await m.disconnect();`,
  ]);
  await page.reload();
  await expect(card.getByText("Verified", { exact: true })).toBeVisible();
  await card.getByRole("switch", { name: "Sign-in through Okta" }).click();
  await expect(page.getByText("Single sign-on is on")).toBeVisible();
  // Requiring SSO waits for a passed test sign-in.
  await expect(page.getByRole("switch", { name: "Require single sign-on" })).toBeDisabled();
  await page.screenshot({ path: "test-results/sso-settings.png", fullPage: true });

  // ---- A colleague's "Continue with SSO" lands at the IdP ----
  const visitor = await browser.newContext();
  contexts.push(visitor);
  const login = await visitor.newPage();
  await login.route("https://idp.example.test/**", (route) => route.fulfill({ status: 200, body: "IdP sign-in" }));
  await login.goto("/login");
  await login.getByRole("button", { name: "Continue with SSO" }).click();
  await login.getByLabel("Work email").fill(`ada@${domain}`);
  const toIdp = login.waitForRequest((request) => request.url().startsWith("https://idp.example.test/sso"));
  await login.getByRole("form", { name: "Sign in with single sign-on" }).getByRole("button", { name: "Continue with SSO" }).click();
  const idpUrl = new URL((await toIdp).url());
  expect(idpUrl.searchParams.get("SAMLRequest")).toBeTruthy();
  expect(idpUrl.searchParams.get("RelayState")).toBeTruthy();

  // ---- SCIM: a token for the IdP, used, then revoked ----
  await page.goto("/settings/scim");
  await expect(page.getByText("SCIM base URL (tenant URL)")).toBeVisible();
  await page.getByLabel("Name").fill("Okta provisioning");
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText("Copy the token now. It is not shown again.")).toBeVisible();
  const token = (await page.getByRole("status").locator("code").textContent())!.trim();
  expect(token).toMatch(/^scim_/);
  const config = await fetch(`${e2eEnv.apiOrigin}/scim/v2/ServiceProviderConfig`, { headers: { Authorization: `Bearer ${token}` } });
  expect(config.status).toBe(200);
  await page.screenshot({ path: "test-results/scim-settings.png", fullPage: true });
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Token revoked")).toBeVisible();
  expect((await fetch(`${e2eEnv.apiOrigin}/scim/v2/Users`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
});
