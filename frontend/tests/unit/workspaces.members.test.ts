import { beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { actionOptions, describeAction, describeActor, describeEvent } from "@/features/workspaces/audit/format";
import type { AuditEvent } from "@/features/workspaces/audit/types";
import { forgetInvite, invitePath, isInvitePath, rememberInvite, takeInviteRedirect } from "@/features/workspaces/invites/pendingInvite";
import { RoleSelect } from "@/features/workspaces/members/components/RoleSelect";
import {
  ROLE_ORDER,
  assignableRoles,
  canChangeMember,
  describeSeats,
  hasFreeSeat,
  invitableRoles,
} from "@/features/workspaces/members/roles";
import type { Member } from "@/features/workspaces/members/types";
import { addShare, candidatesFor, changeShareRole, isRedundant, removeShare, sameShares, toInputs } from "@/features/workspaces/sharing/shareModel";
import type { ShareEntry, ShareGroup } from "@/features/workspaces/sharing/types";
import type { WorkspaceRole } from "@/features/workspaces/types";

const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";

describe("who may change whom", () => {
  test("managers assign roles up to their own; only owners hand out ownership", () => {
    expect(assignableRoles("owner")).toEqual(["owner", "admin", "editor", "presenter", "viewer"]);
    expect(assignableRoles("admin")).toEqual(["admin", "editor", "presenter", "viewer"]);
    expect(assignableRoles("editor")).toEqual(["editor", "presenter", "viewer"]);
    expect(assignableRoles("viewer")).toEqual(["viewer"]);
  });

  test("invitations never carry the owner role", () => {
    expect(invitableRoles("owner")).toEqual(["admin", "editor", "presenter", "viewer"]);
    expect(invitableRoles("admin")).toEqual(["admin", "editor", "presenter", "viewer"]);
    expect(invitableRoles("editor")).toEqual(["editor", "presenter", "viewer"]);
  });

  test("members of equal or lower rank can be changed, owners only by owners", () => {
    const target = (role: WorkspaceRole) => ({ role, isPrimaryOwner: false });
    for (const role of ROLE_ORDER) expect(canChangeMember("owner", target(role))).toBe(true);
    expect(canChangeMember("admin", target("owner"))).toBe(false);
    expect(canChangeMember("admin", target("admin"))).toBe(true);
    expect(canChangeMember("admin", target("editor"))).toBe(true);
    expect(canChangeMember("editor", target("admin"))).toBe(false);
  });
});

describe("seats", () => {
  test("describes use of the plan", () => {
    expect(describeSeats({ used: 3, pending: 0, limit: 5 })).toBe("3 of 5 seats used");
    expect(describeSeats({ used: 1, pending: 2, limit: 1 })).toBe("1 of 1 seat used (2 pending)");
    expect(describeSeats({ used: 1, pending: 0, limit: null })).toBe("1 member");
    expect(describeSeats({ used: 12, pending: 1, limit: null })).toBe("12 members (1 pending)");
  });

  test("pending invitations reserve a seat", () => {
    expect(hasFreeSeat({ used: 3, pending: 1, limit: 5 })).toBe(true);
    expect(hasFreeSeat({ used: 3, pending: 2, limit: 5 })).toBe(false);
    expect(hasFreeSeat({ used: 99, pending: 9, limit: null })).toBe(true);
  });
});

describe("RoleSelect", () => {
  test("lists the allowed roles and keeps showing the current one, disabled, when it is not allowed", () => {
    const html = renderToStaticMarkup(
      RoleSelect({ value: "owner", roles: ["admin", "editor"], onChange: () => undefined, label: "Role of Ana" }),
    );
    expect(html).toContain('aria-label="Role of Ana"');
    expect(html).toMatch(/<option value="owner" disabled="" selected="">Owner<\/option>/);
    expect(html).toMatch(/<option value="admin">Admin<\/option>/);
    expect(html).toMatch(/<option value="editor">Editor<\/option>/);
    expect(html).not.toContain('value="viewer"');
  });
});

describe("carrying an invitation through sign-in", () => {
  beforeEach(() => localStorage.clear());

  test("only /invites/<token> paths qualify", () => {
    expect(isInvitePath(invitePath(TOKEN))).toBe(true);
    for (const value of ["/polls", "//evil.example/invites/x", "https://evil.example/invites/" + TOKEN, "/invites/", "/invites/short", `/invites/${TOKEN}/accept`, `/invites/${TOKEN}?x=1`, null, undefined, 42]) {
      expect(isInvitePath(value)).toBe(false);
    }
  });

  test("a valid ?next= wins and clears what was remembered", () => {
    rememberInvite(invitePath("R".repeat(43)));
    expect(takeInviteRedirect(invitePath(TOKEN))).toBe(invitePath(TOKEN));
    expect(takeInviteRedirect(null)).toBeNull();
  });

  test("a remembered invitation is used once, within a day", () => {
    rememberInvite(invitePath(TOKEN), 1_000);
    expect(takeInviteRedirect(null, 1_000 + 60_000)).toBe(invitePath(TOKEN));
    expect(takeInviteRedirect(null, 1_000 + 60_000)).toBeNull();

    rememberInvite(invitePath(TOKEN), 1_000);
    expect(takeInviteRedirect(null, 1_000 + 25 * 3600_000)).toBeNull();
  });

  test("ignores an open-redirect ?next= and junk in storage", () => {
    expect(takeInviteRedirect("//evil.example")).toBeNull();
    expect(takeInviteRedirect("https://evil.example/invites/" + TOKEN)).toBeNull();
    localStorage.setItem("openpoll_pending_invite", "{not json");
    expect(takeInviteRedirect(null)).toBeNull();
    localStorage.setItem("openpoll_pending_invite", JSON.stringify({ path: "https://evil.example", savedAt: Date.now() }));
    expect(takeInviteRedirect(null)).toBeNull();
  });

  test("the privacy page is the one other page a sign-in may return to", () => {
    expect(takeInviteRedirect("/settings/privacy")).toBe("/settings/privacy");
    rememberInvite("/settings/privacy", 1_000);
    expect(takeInviteRedirect(null, 2_000)).toBe("/settings/privacy");
    expect(takeInviteRedirect("/settings/privacy/../billing")).toBeNull();
  });

  test("rememberInvite refuses anything but an invite path, and forgetInvite clears it", () => {
    rememberInvite("/polls");
    expect(localStorage.getItem("openpoll_pending_invite")).toBeNull();
    rememberInvite(invitePath(TOKEN));
    forgetInvite();
    expect(takeInviteRedirect(null)).toBeNull();
  });
});

describe("share list editing", () => {
  const entry = (id: string, role: ShareEntry["role"], workspaceRole: ShareEntry["workspaceRole"] = "viewer", principalType: ShareEntry["principalType"] = "user"): ShareEntry => ({
    principalType,
    principalId: id,
    role,
    name: `Name ${id}`,
    email: principalType === "user" ? `${id}@example.com` : null,
    workspaceRole,
  });
  const member = (userId: string, overrides: Partial<Member> = {}): Member => ({
    userId,
    name: `Member ${userId}`,
    email: `${userId}@example.com`,
    picture: null,
    role: "viewer",
    status: "active",
    source: "manual",
    joinedAt: "2026-10-19T00:00:00.000Z",
    isPrimaryOwner: false,
    ...overrides,
  });
  const group: ShareGroup = { id: "g1", name: "Trainers", memberCount: 3 };

  test("changes and removes by principal, and sends only what the API takes", () => {
    const list = [entry("a", "viewer"), entry("b", "editor"), entry("a", "presenter", null, "group")];
    expect(changeShareRole(list, list[0]!, "editor").map((e) => [e.principalType, e.principalId, e.role])).toEqual([
      ["user", "a", "editor"],
      ["user", "b", "editor"],
      ["group", "a", "presenter"],
    ]);
    expect(removeShare(list, list[2]!).map((e) => e.principalId)).toEqual(["a", "b"]);
    expect(toInputs([list[0]!])).toEqual([{ principalType: "user", principalId: "a", role: "viewer" }]);
  });

  test("tells whether anything changed, whatever the order", () => {
    const a = [entry("a", "viewer"), entry("b", "editor")];
    expect(sameShares(a, [a[1]!, a[0]!])).toBe(true);
    expect(sameShares(a, [a[0]!])).toBe(false);
    expect(sameShares(a, [a[0]!, { ...a[1]!, role: "viewer" }])).toBe(false);
  });

  test("offers active members and groups not yet shared with, never the caller", () => {
    const members = [
      member("me"),
      member("zed", { name: "Zed" }),
      member("amy", { name: "Amy" }),
      member("gone", { status: "suspended" }),
      member("taken"),
    ];
    const candidates = candidatesFor(members, [group], [entry("taken", "viewer")], "me");
    expect(candidates.map((c) => `${c.principalType}:${c.name}`)).toEqual(["user:Amy", "user:Zed", "group:Trainers"]);
    expect(candidatesFor(members, [group], [entry("g1", "viewer", null, "group")], "me").some((c) => c.principalType === "group")).toBe(false);
  });

  test("adds a candidate with the chosen role", () => {
    const [first] = candidatesFor([member("amy", { name: "Amy", role: "presenter" })], [], [], null);
    expect(addShare([], first!, "editor")).toEqual([
      { principalType: "user", principalId: "amy", name: "Amy", email: "amy@example.com", workspaceRole: "presenter", role: "editor" },
    ]);
  });

  test("flags shares the member's own role already covers", () => {
    expect(isRedundant({ role: "viewer", workspaceRole: "viewer" })).toBe(true);
    expect(isRedundant({ role: "viewer", workspaceRole: "editor" })).toBe(true);
    expect(isRedundant({ role: "editor", workspaceRole: "viewer" })).toBe(false);
    expect(isRedundant({ role: "viewer", workspaceRole: null })).toBe(false);
  });
});

describe("audit log text", () => {
  const event = (action: string, meta: AuditEvent["meta"] = null, overrides: Partial<AuditEvent> = {}): AuditEvent => ({
    id: "e1",
    action,
    actorType: "user",
    actor: { id: "u1", name: "Alice", email: "alice@example.com" },
    targetType: "user",
    targetId: "64b0000000000000000000a1",
    ip: null,
    ua: null,
    meta,
    createdAt: "2026-10-19T10:00:00.000Z",
    ...overrides,
  });

  test("names known actions and humanizes unknown ones", () => {
    expect(describeAction("member.role.update")).toBe("Changed a member's role");
    expect(describeAction("brand.kit_create")).toBe("Brand kit create");
  });

  test("summarizes what happened without leaking more than the audit meta carries", () => {
    expect(describeEvent(event("member.role.update", { from: "viewer", to: "editor", email: "bob@example.com" }))).toBe(
      "bob@example.com: Viewer → Editor",
    );
    expect(describeEvent(event("invite.create", { email: "new@example.com", role: "admin" }))).toBe("new@example.com as Admin");
    expect(describeEvent(event("invite.accept", { email: "new@example.com", role: "editor" }))).toBe("new@example.com joined as Editor");
    expect(describeEvent(event("member.remove", { role: "presenter" }))).toBe("Was Presenter");
    expect(
      describeEvent(event("share.update", { principalType: "group", role: "editor", previousRole: "viewer", title: "Q3 kickoff" }, { targetType: "presentation" })),
    ).toBe('"Q3 kickoff" with a group: Editor (was Viewer)');
    expect(describeEvent(event("share.revoke", { principalType: "user", previousRole: "editor", title: "Q3" }))).toBe('"Q3" with a member (was Editor)');
    expect(describeEvent(event("workspace.update", { fields: ["name", "settings.retentionDays"] }))).toBe("Changed name, settings.retentionDays");
    expect(describeEvent(event("something.else"))).toBe("user 0000a1");
  });

  test("names the actor, or the kind of automated actor", () => {
    expect(describeActor(event("x"))).toBe("Alice");
    expect(describeActor(event("x", null, { actor: null, actorType: "system" }))).toBe("System");
    expect(describeActor(event("x", null, { actor: null, actorType: "scim" }))).toBe("SCIM");
    expect(describeActor(event("x", null, { actor: null, actorType: "api" }))).toBe("API token");
    expect(describeActor(event("x", null, { actor: null, actorType: "user" }))).toBe("Former member");
  });

  test("offers groups only for prefixes that were recorded", () => {
    const options = actionOptions(["member.remove", "invite.create"]);
    expect(options.map((option) => option.value)).toEqual(["", "member.*", "invite.*", "member.remove", "invite.create"]);
    expect(options[0]?.label).toBe("All actions");
    expect(actionOptions([]).map((option) => option.value)).toEqual([""]);
  });
});
