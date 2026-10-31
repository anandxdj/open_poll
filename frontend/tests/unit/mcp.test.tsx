import { beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ConsentRequest, McpGrant, McpTokenMeta } from "@/features/mcp/api/mcp.api";
import { ConsentForm, consentPath } from "@/features/mcp/components/OAuthConsent";
import { ConnectedAppsList, ConnectorSteps, TokenList } from "@/features/mcp/components/McpSettingsSection";
import { isPollOnly } from "@/features/mcp/scopes";
import { rememberInvite, takeInviteRedirect } from "@/features/workspaces/invites/pendingInvite";

const REQUEST_ID = "A".repeat(43);

const consent: ConsentRequest = {
  request: {
    client: { name: "Claude", redirectTo: "claude.ai" },
    scopes: [
      { scope: "deck:write", label: "Create and edit decks" },
      { scope: "session:run", label: "Run live sessions: open the lobby, move slides, reveal and end" },
    ],
    expiresAt: "2026-10-26T12:10:00.000Z",
  },
  workspaces: [
    { id: "w1", name: "Personal", type: "personal", role: "owner", plan: "free" },
    { id: "w2", name: "Acme", type: "team", role: "presenter", plan: "team" },
  ],
  defaultWorkspaceId: "w1",
};

const form = (over: Partial<Parameters<typeof ConsentForm>[0]> = {}) =>
  renderToStaticMarkup(
    <ConsentForm
      consent={consent}
      userEmail="ada@example.com"
      workspaceId="w2"
      scopes={new Set(["deck:write", "session:run"])}
      busy={null}
      error={null}
      onWorkspace={() => {}}
      onToggleScope={() => {}}
      onApprove={() => {}}
      onDeny={() => {}}
      {...over}
    />,
  );

const token = (over: Partial<McpTokenMeta> = {}): McpTokenMeta => ({
  id: "t1",
  prefix: "abcd1234",
  last4: "wxyz",
  label: "Claude Desktop",
  scopes: ["poll:read", "deck:read", "deck:write", "session:run", "results:read"],
  workspaceId: null,
  lastUsedAt: null,
  expiresAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("MCP consent page", () => {
  test("says who asks, where the browser returns, and that the app is unverified", () => {
    const html = form();
    expect(html).toContain("Open Poll has not verified this app");
    expect(html).toContain("claude.ai");
    expect(html).toContain("Allow Claude");
    expect(html).toContain("Signed in as <span");
  });

  test("lists the workspaces with roles and explains the role limit", () => {
    const html = form();
    expect(html).toMatch(/<option value="w2" selected="">Acme \(Presenter\)<\/option>/);
    expect(html).toContain("can only do what your role (Presenter) allows there");
  });

  test("ticks the permissions the user keeps and blocks Allow when none are left", () => {
    const html = form({ scopes: new Set(["deck:write"]) });
    expect(html.match(/checked=""/g)?.length).toBe(1);
    expect(form({ scopes: new Set() })).toMatch(/<button[^>]*disabled=""[^>]*>Allow Claude<\/button>/);
  });

  test("shows the error from a failed answer", () => {
    expect(form({ error: "Choose at least one of the permissions the app asked for" })).toContain('role="alert"');
  });

  test("brings a signed-out visitor back to the request after sign-in", () => {
    localStorage.clear();
    expect(takeInviteRedirect(consentPath(REQUEST_ID))).toBe(`/oauth/consent?request=${REQUEST_ID}`);
    rememberInvite(consentPath(REQUEST_ID), 1_000);
    expect(takeInviteRedirect(null, 2_000)).toBe(`/oauth/consent?request=${REQUEST_ID}`);
    expect(takeInviteRedirect("/oauth/consent?request=x&next=//evil.example")).toBeNull();
    expect(takeInviteRedirect("/oauth/consent")).toBeNull();
  });
});

describe("MCP settings", () => {
  beforeEach(() => localStorage.clear());

  test("shows the server address to add as a connector", () => {
    const html = renderToStaticMarkup(<ConnectorSteps mcpUrl="https://openpoll.example/mcp" />);
    expect(html).toContain("https://openpoll.example/mcp");
    expect(html).toContain("Add custom connector");
  });

  test("lists connected apps with their workspace and permissions", () => {
    const grants: McpGrant[] = [
      {
        id: "g1",
        clientName: "ChatGPT",
        workspace: { id: "w2", name: "Acme" },
        scopes: ["deck:read", "results:read"],
        createdAt: "2026-10-01T00:00:00.000Z",
        lastUsedAt: null,
      },
    ];
    const html = renderToStaticMarkup(<ConnectedAppsList grants={grants} onRevoke={() => {}} />);
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Acme · Last used never");
    expect(html).toContain("Session results");
    expect(html).toContain("Disconnect");
    expect(renderToStaticMarkup(<ConnectedAppsList grants={[]} onRevoke={() => {}} />)).toContain("No apps connected yet.");
  });

  test("labels tokens from before decks as polls only and names the pinned workspace", () => {
    const html = renderToStaticMarkup(
      <TokenList
        tokens={[
          token({ id: "old", label: "Old laptop", scopes: ["poll:create", "poll:edit", "poll:read", "analytics:read"] }),
          token({ id: "new", label: "Cursor", workspaceId: "w2" }),
        ]}
        workspaceNames={new Map([["w2", "Acme"]])}
        onRevoke={() => {}}
      />,
    );
    expect(html.match(/Polls only/g)?.length).toBe(1);
    expect(html).toContain("Generate a new token to use them");
    expect(html).toContain("Acme ·");
    expect(html).toContain("Your current workspace ·");
    expect(isPollOnly(["poll:read"])).toBe(true);
    expect(isPollOnly(token().scopes)).toBe(false);
  });
});
