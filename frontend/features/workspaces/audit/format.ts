import { ROLE_NAMES, type WorkspaceRole } from "../types";
import type { AuditEvent } from "./types";

/** Readable names for the actions recorded today; unknown actions fall back to a humanized verb. */
export const ACTION_LABELS: Record<string, string> = {
  "member.role.update": "Changed a member's role",
  "member.status.update": "Changed a member's status",
  "member.remove": "Removed a member",
  "member.leave": "Left the workspace",
  "workspace.owner.transfer": "Transferred ownership",
  "workspace.create": "Created the workspace",
  "workspace.update": "Updated the workspace",
  "workspace.plan.set": "Changed the plan",
  "invite.create": "Invited someone",
  "invite.refresh": "Re-sent an invitation",
  "invite.revoke": "Revoked an invitation",
  "invite.accept": "Accepted an invitation",
  "share.grant": "Shared with someone",
  "share.update": "Changed a share",
  "share.revoke": "Stopped sharing",
  "media.upload": "Uploaded a file",
  "poll.convert": "Converted a poll to a deck",
};

/** Groups offered as `prefix.*` filters. */
export const ACTION_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "member", label: "Members" },
  { prefix: "invite", label: "Invitations" },
  { prefix: "share", label: "Sharing" },
  { prefix: "workspace", label: "Workspace" },
];

export function describeAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const text = action.replace(/[._]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : action;
}

const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

const role = (value: unknown): string | null => {
  const text = asString(value);
  return text ? (ROLE_NAMES[text as WorkspaceRole] ?? text) : null;
};

const targetOf = (event: AuditEvent) => {
  const email = asString(event.meta?.email);
  if (email) return email;
  const title = asString(event.meta?.title);
  if (title) return `"${title}"`;
  return event.targetId ? `${event.targetType ?? "target"} ${event.targetId.slice(-6)}` : null;
};

/** One line of detail for the audit table (no secrets: events never carry tokens). */
export function describeEvent(event: AuditEvent): string {
  const meta = event.meta ?? {};
  switch (event.action) {
    case "member.role.update":
      return `${targetOf(event) ?? "Member"}: ${role(meta.from) ?? "?"} → ${role(meta.to) ?? "?"}`;
    case "member.status.update":
      return `${targetOf(event) ?? "Member"}: ${asString(meta.from) ?? "?"} → ${asString(meta.to) ?? "?"}`;
    case "member.remove":
    case "member.leave":
      return role(meta.role) ? `Was ${role(meta.role)}` : "";
    case "invite.create":
    case "invite.refresh":
    case "invite.revoke":
      return `${asString(meta.email) ?? "Someone"} as ${role(meta.role) ?? "?"}`;
    case "invite.accept":
      return `${asString(meta.email) ?? "Someone"} joined as ${role(meta.role) ?? "?"}`;
    case "share.grant":
    case "share.update":
    case "share.revoke": {
      const to = asString(meta.principalType) === "group" ? "a group" : "a member";
      const next = role(meta.role);
      const before = role(meta.previousRole);
      const what = `${targetOf(event) ?? "Resource"} with ${to}`;
      if (event.action === "share.revoke") return `${what}${before ? ` (was ${before})` : ""}`;
      return `${what}: ${next ?? "?"}${before ? ` (was ${before})` : ""}`;
    }
    case "workspace.update": {
      const fields = Array.isArray(meta.fields) ? meta.fields.filter((field) => typeof field === "string") : [];
      return fields.length ? `Changed ${fields.join(", ")}` : "";
    }
    case "workspace.plan.set":
      return asString(meta.plan) ? `Plan: ${String(meta.plan)}` : "";
    default:
      return targetOf(event) ?? "";
  }
}

export interface ActionOption {
  value: string;
  label: string;
}

/** Filter choices: all, then each group that has events, then each recorded action. */
export function actionOptions(actions: readonly string[]): ActionOption[] {
  const groups = ACTION_GROUPS.filter((group) => actions.some((action) => action.startsWith(`${group.prefix}.`))).map((group) => ({
    value: `${group.prefix}.*`,
    label: `${group.label} (all)`,
  }));
  return [{ value: "", label: "All actions" }, ...groups, ...actions.map((action) => ({ value: action, label: describeAction(action) }))];
}

/** Who did it: a user's name, or the kind of automated actor. */
export function describeActor(event: AuditEvent): string {
  if (event.actor) return event.actor.name;
  switch (event.actorType) {
    case "system":
      return "System";
    case "scim":
      return "SCIM";
    case "api":
      return "API token";
    default:
      return "Former member";
  }
}
