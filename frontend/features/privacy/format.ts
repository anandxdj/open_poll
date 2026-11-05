import type { PrivacyStatus, WorkspaceRef } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "24 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "October 26, 2026" in the viewer's time zone. */
export const formatLongDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/** The day the account would go if deleted now. */
export const purgeDateFrom = (now: number, graceDays: number) => new Date(now + graceDays * DAY_MS);

/** "Design team", "Design team and Sales", "Design team, Sales and Ops". */
export function listNames(workspaces: WorkspaceRef[]): string {
  const names = workspaces.map((w) => w.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What deleting the account does, in order, for the confirmation dialog. */
export function deletionConsequences(status: PrivacyStatus, purgeDate: Date): string[] {
  const date = formatLongDate(purgeDate);
  const { deleted, left } = status.workspaces;
  const lines = ["You're signed out everywhere, and AI assistant (MCP) tokens stop working."];
  const teams = deleted.filter((w) => w.type === "team");
  lines.push(
    teams.length
      ? `On ${date} we delete your account, your personal workspace and ${listNames(teams)}, with everything in them.`
      : `On ${date} we delete your account and your personal workspace, with everything in it.`,
  );
  if (left.length) lines.push(`You leave ${listNames(left)}. What you made there stays with the team.`);
  lines.push(`Changed your mind? Log in before ${date} and nothing is deleted.`);
  return lines;
}

/** Whether a fresh proof of identity still covers deleting the account. */
export const reauthValid = (status: PrivacyStatus, now: number) =>
  status.reauthUntil !== null && Date.parse(status.reauthUntil) > now;
