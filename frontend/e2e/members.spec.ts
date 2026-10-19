import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { expect, test } from "./fixtures";

/**
 * Teams, roles, sharing and audit (W3-B1) as users see them: the owner of a
 * team workspace invites a second person, who accepts the emailed link after
 * signing in, becomes an editor, sees the workspace's deck and cannot manage
 * members; the owner then demotes them, shares one deck back with the
 * ShareDialog and finds it all in the audit log.
 *
 * The e2e backend has no mail provider, so the invite link is read from the
 * create response (the form shows it, as it does for any server without mail).
 */

type Json = Record<string, unknown>;

const backendEnv = {
  ...process.env,
  MONGO_URI: e2eEnv.mongoUri,
  REDIS_URL: e2eEnv.redisUrl,
  FRONTEND_URL: e2eEnv.frontendUrl,
  JWT_ACCESS_SECRET: "e2e-access-secret",
  JWT_REFRESH_SECRET: "e2e-refresh-secret",
  ID_SIGNING_SECRET: "e2e-id-signing-secret",
};

const runBackendScript = (script: string, args: string[]) =>
  execFileSync("bun", [script, ...args], { cwd: e2eEnv.backendDir, env: backendEnv, stdio: "pipe" });

interface Account {
  user: { _id: string; email: string; name: string };
  accessToken: string;
}

async function api<T = Json>(path: string, init: Omit<RequestInit, "body"> & { token?: string; workspaceId?: string; body?: unknown } = {}) {
  const { token, workspaceId, body, headers, ...rest } = init;
  const res = await fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { data: T } & Json;
  return { status: res.status, json, data: json?.data as T };
}

const signIn = async (email: string, password: string): Promise<Account> => {
  const { status, data } = await api<Account>("/auth/login", { method: "POST", body: { email, password } });
  expect(status).toBe(200);
  return data;
};

/** A page signed in as `account` with `workspaceId` selected, like a returning user who switched to it. */
async function openAs(browser: Browser, contexts: BrowserContext[], account: Account, workspaceId: string, path: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  await context.addInitScript(
    ({ user, accessToken, workspaceId }) => {
      window.localStorage.setItem("auth-storage", JSON.stringify({ state: { user, accessToken }, version: 0 }));
      window.localStorage.setItem(
        "openpoll_workspace",
        JSON.stringify({ state: { userId: user._id, currentWorkspaceId: workspaceId }, version: 1 }),
      );
      document.cookie = "auth_session=1; path=/; samesite=lax";
    },
    { user: account.user, accessToken: account.accessToken, workspaceId },
  );
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test("an owner invites a teammate who joins as editor; roles, sharing and the audit log follow", async ({ browser, contexts }) => {
  const stamp = Date.now();
  const teamName = `E2E Team ${stamp}`;
  const memberEmail = `e2e-member-${stamp}@openpoll.test`;
  const memberPassword = "E2eMember!2345";
  const deckTitle = `Team kickoff ${stamp}`;

  // ---- Fixtures: a second verified account, a team workspace on a plan with seats, one deck in it ----
  runBackendScript("scripts/seed-e2e-user.ts", [memberEmail, memberPassword, "E2E Member"]);
  const owner = await signIn(e2eEnv.hostEmail, e2eEnv.hostPassword);
  const created = await api<{ workspace: { _id: string; slug: string } }>("/workspaces", {
    method: "POST",
    token: owner.accessToken,
    body: { name: teamName },
  });
  expect(created.status).toBe(201);
  const { _id: workspaceId, slug } = created.data.workspace;
  runBackendScript("scripts/set-plan.ts", [slug, "team"]);
  const deck = await api<{ _id: string }>("/presentations", {
    method: "POST",
    token: owner.accessToken,
    workspaceId,
    body: {
      title: deckTitle,
      slides: [{ type: "select_answer", question: "Ready?", options: [{ text: "Yes", isCorrect: true }, { text: "No", isCorrect: false }] }],
    },
  });
  expect(deck.status).toBe(201);

  // ---- The owner invites the teammate from the members page ----
  const ownerPage = await openAs(browser, contexts, owner, workspaceId, "/settings/members");
  await expect(ownerPage.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(ownerPage.getByText("1 of 5 seats used")).toBeVisible();
  await expect(ownerPage.getByTestId("member-row")).toHaveCount(1);

  await ownerPage.getByLabel("Invite by email").fill(memberEmail);
  await expect(ownerPage.getByLabel("Role of the invited person")).toHaveValue("editor");
  await ownerPage.getByRole("button", { name: "Send invite" }).click();
  const result = ownerPage.getByTestId("invite-result");
  await expect(result).toContainText(`Invitation created for ${memberEmail}`);
  await expect(result).toContainText("Email isn't set up on this server");
  const inviteLink = await ownerPage.getByLabel("Invitation link").inputValue();
  expect(inviteLink).toMatch(/\/invites\/[A-Za-z0-9_-]{40,}$/);
  await expect(ownerPage.getByTestId("pending-invite")).toContainText(memberEmail);
  await expect(ownerPage.getByText("1 of 5 seats used (1 pending)")).toBeVisible();

  // ---- The teammate opens the link signed out, signs in, is sent back, and joins ----
  const memberContext = await browser.newContext();
  contexts.push(memberContext);
  const memberPage = await memberContext.newPage();
  await memberPage.goto(new URL(inviteLink).pathname);
  await expect(memberPage.getByRole("heading", { name: `Join ${teamName} on Open Poll` })).toBeVisible();
  await expect(memberPage.getByText("Editor", { exact: true })).toBeVisible();
  // Only a masked address is shown to someone who has not signed in.
  await expect(memberPage.getByText(`e2e-member-${stamp}@openpoll.test`)).toHaveCount(0);
  await memberPage.getByRole("link", { name: "Sign in to accept" }).click();

  await memberPage.waitForURL(/\/login\?next=/);
  await memberPage.getByLabel("Email").fill(memberEmail);
  await memberPage.getByLabel("Password").fill(memberPassword);
  await memberPage.getByRole("button", { name: "Sign in" }).click();
  await memberPage.waitForURL(/\/invites\//);
  await expect(memberPage.getByText(`Signed in as ${memberEmail}`)).toBeVisible();
  await memberPage.getByRole("button", { name: `Join ${teamName}` }).click();

  // They land in the shared workspace and see its deck.
  await memberPage.waitForURL(/\/polls/);
  await expect(memberPage.getByRole("heading", { name: deckTitle })).toBeVisible();

  // The invitation is single use.
  await memberPage.goto(new URL(inviteLink).pathname);
  await expect(memberPage.getByRole("heading", { name: "This invitation can't be used" })).toBeVisible();

  // ---- As an editor the teammate cannot manage members or read the audit log ----
  const member = await signIn(memberEmail, memberPassword);
  await memberPage.goto("/settings/members");
  await expect(memberPage.getByTestId("member-row")).toHaveCount(2);
  await expect(memberPage.getByText("Only owners and admins can change roles and invite people.")).toBeVisible();
  await expect(memberPage.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await expect(memberPage.getByLabel("Role of E2E Host")).toBeDisabled();
  await memberPage.goto("/settings/audit");
  await expect(memberPage.getByText("Only owners and admins can see the audit log.")).toBeVisible();
  const refused = await api(`/workspaces/${workspaceId}/members/${owner.user._id}`, {
    method: "PATCH",
    token: member.accessToken,
    body: { role: "viewer" },
  });
  expect(refused.status).toBe(403);
  const invitedAnother = await api(`/workspaces/${workspaceId}/invites`, {
    method: "POST",
    token: member.accessToken,
    body: { email: "someone@example.com", role: "viewer" },
  });
  expect(invitedAnother.status).toBe(403);

  // ...but can edit the deck (editor role).
  const edited = await api(`/presentations/${deck.data._id}`, {
    method: "PATCH",
    token: member.accessToken,
    workspaceId,
    body: { title: deckTitle },
  });
  expect(edited.status).toBe(200);

  // ---- The owner demotes the teammate to viewer ----
  await ownerPage.reload();
  const memberRow = ownerPage.locator(`[data-testid="member-row"][data-email="${memberEmail}"]`);
  await expect(memberRow).toBeVisible();
  await expect(ownerPage.getByTestId("pending-invite")).toHaveCount(0);
  await expect(ownerPage.getByText("2 of 5 seats used")).toBeVisible();
  await memberRow.getByLabel("Role of E2E Member").selectOption("viewer");
  await expect(memberRow.getByLabel("Role of E2E Member")).toHaveValue("viewer");
  await expect
    .poll(async () => (await api(`/presentations/${deck.data._id}`, { method: "PATCH", token: member.accessToken, workspaceId, body: { title: deckTitle } })).status)
    .toBe(403);
  expect((await api(`/presentations/${deck.data._id}`, { token: member.accessToken, workspaceId })).status).toBe(200);

  // ---- ...and shares the deck back with them through the ShareDialog ----
  await ownerPage.goto("/polls");
  const card = ownerPage.locator("article", { hasText: deckTitle });
  await card.getByRole("button", { name: `More actions for ${deckTitle}` }).click();
  await ownerPage.getByRole("menuitem", { name: "Share with team…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: new RegExp(`Share .*${deckTitle}`) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Not shared with anyone yet.")).toBeVisible();
  await dialog.getByLabel("Member or group to share with").selectOption({ label: `E2E Member (${memberEmail})` });
  await dialog.getByLabel("Role to grant").selectOption("editor");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByTestId("share-row")).toContainText("E2E Member");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  // The viewer can now edit this deck, but only this deck, and cannot delete or re-share it.
  const reedited = await api(`/presentations/${deck.data._id}`, {
    method: "PATCH",
    token: member.accessToken,
    workspaceId,
    body: { title: `${deckTitle} (edited by member)` },
  });
  expect(reedited.status).toBe(200);
  expect((await api(`/presentations/${deck.data._id}`, { method: "DELETE", token: member.accessToken, workspaceId })).status).toBe(403);
  expect((await api(`/shares?resourceType=presentation&resourceId=${deck.data._id}`, { token: member.accessToken, workspaceId })).status).toBe(403);

  // ---- The audit log shows all of it, newest first, and filters ----
  await ownerPage.goto("/settings/audit");
  const rows = ownerPage.getByTestId("audit-row");
  await expect(rows.first()).toBeVisible();
  const actions = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-action")));
  for (const action of ["invite.create", "invite.accept", "member.role.update", "share.grant"]) expect(actions).toContain(action);
  expect(actions.indexOf("share.grant")).toBeLessThan(actions.indexOf("invite.create"));
  await expect(rows.filter({ hasText: "Accepted an invitation" })).toContainText(memberEmail);
  await expect(rows.filter({ hasText: "Changed a member's role" })).toContainText("Editor → Viewer");

  await ownerPage.getByLabel("Action").selectOption("share.*");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-action", "share.grant");
  await ownerPage.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows.nth(3)).toBeVisible();
});
