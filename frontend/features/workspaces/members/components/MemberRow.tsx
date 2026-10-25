"use client";

import { Crown, Loader2, LogOut, MoreHorizontal, PauseCircle, PlayCircle, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "../../types";
import { assignableRoles, canChangeMember } from "../roles";
import type { Member } from "../types";
import { RoleSelect } from "./RoleSelect";

export type MemberAction = "suspend" | "reactivate" | "remove" | "leave" | "transfer";

interface MemberRowProps {
  member: Member;
  selfId: string | null;
  myRole: WorkspaceRole;
  /** The caller holds `workspace:members`. */
  canManage: boolean;
  /** The caller is the primary owner, who alone transfers ownership. */
  isPrimaryOwner: boolean;
  busy: boolean;
  onRoleChange: (member: Member, role: WorkspaceRole) => void;
  onAction: (member: Member, action: MemberAction) => void;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

/** One member: who they are, their role (editable by managers) and a menu of actions. */
export function MemberRow({ member, selfId, myRole, canManage, isPrimaryOwner, busy, onRoleChange, onAction }: MemberRowProps) {
  const isSelf = member.userId === selfId;
  const manageable = canManage && !isSelf && canChangeMember(myRole, member);
  // Owners are demoted through a role change too, but the primary owner first hands over the billing contact.
  const roleEditable = manageable && !member.isPrimaryOwner;
  const actions: { action: MemberAction; label: string; icon: React.ReactNode; danger?: boolean }[] = [];
  if (manageable) {
    actions.push(
      member.status === "suspended"
        ? { action: "reactivate", label: "Reactivate", icon: <PlayCircle className="size-4" /> }
        : { action: "suspend", label: "Suspend", icon: <PauseCircle className="size-4" /> },
    );
  }
  if (isPrimaryOwner && !isSelf && member.status === "active") {
    actions.push({ action: "transfer", label: "Make primary owner", icon: <Crown className="size-4" /> });
  }
  if (manageable && !member.isPrimaryOwner) {
    actions.push({ action: "remove", label: "Remove from workspace", icon: <UserMinus className="size-4" />, danger: true });
  }
  if (isSelf && !member.isPrimaryOwner) {
    actions.push({ action: "leave", label: "Leave workspace", icon: <LogOut className="size-4" />, danger: true });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-testid="member-row" data-email={member.email}>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-medium text-foreground"
      >
        {initials(member.name)}
      </span>
      {/* At least 14rem for who they are; on phones the role and actions wrap below. */}
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">{member.name}</span>
          {isSelf ? <Badge>You</Badge> : null}
          {member.isPrimaryOwner ? <Badge tone="primary">Primary owner</Badge> : null}
          {member.status === "suspended" ? <Badge tone="warn">Suspended</Badge> : null}
          {member.source !== "manual" ? <Badge>{member.source === "scim" ? "SCIM" : "SSO"}</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
      </div>

      <RoleSelect
        value={member.role}
        roles={roleEditable ? assignableRoles(myRole) : [member.role]}
        label={`Role of ${member.name}`}
        disabled={!roleEditable || busy}
        onChange={(role) => onRoleChange(member, role)}
        className="w-32"
      />

      <div className="flex size-9 items-center justify-center">
        {busy ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : actions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${member.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1.5">
              {actions.map((entry, index) => (
                <div key={entry.action}>
                  {entry.danger && index > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    variant={entry.danger ? "destructive" : "default"}
                    className="cursor-pointer"
                    onSelect={() => onAction(member, entry.action)}
                  >
                    {entry.icon}
                    {entry.label}
                  </DropdownMenuItem>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "primary" | "warn" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-medium",
        tone === "primary" && "border-primary/30 bg-primary/10 text-accent-ink",
        tone === "warn" && "border-warning/30 bg-warning/10 text-warning",
        tone === "muted" && "border-border bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
